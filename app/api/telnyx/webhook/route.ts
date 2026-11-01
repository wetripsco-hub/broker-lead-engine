import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { toE164 } from "@/lib/phone"
import { startCallRecording } from "@/lib/telnyx/client"
import { handleCallEvent, type CallEventDeps, type CallRow } from "@/lib/telnyx/call-events"
import { isValidTelnyxSignature } from "@/lib/telnyx/webhook-signature"

// Copying a call recording into storage can take a while on a long call.
export const maxDuration = 60

const CALL_ROW = "id, status, disposition, recording_path"

function callEventDeps(supabase: ReturnType<typeof createAdminClient>): CallEventDeps {
  const events = () => supabase.from("outreach_events") as any
  return {
    async findByExternalId(callControlId) {
      const { data } = await events().select(CALL_ROW).eq("external_id", callControlId).eq("channel", "call").limit(1).maybeSingle()
      return (data as CallRow | null) ?? null
    },
    async linkEvent(eventId, agentId, callControlId) {
      const { data } = await events()
        .update({ external_id: callControlId })
        .eq("id", eventId)
        .eq("agent_id", agentId)
        .eq("channel", "call")
        .is("external_id", null)
        .select(CALL_ROW)
        .maybeSingle()
      return (data as CallRow | null) ?? null
    },
    async insertLegacyRow(leadId, agentId, callControlId) {
      await events().insert({
        lead_id: leadId,
        agent_id: agentId,
        channel: "call",
        status: "pending",
        direction: "outbound",
        external_id: callControlId,
      })
    },
    async updateStatus(id, status) {
      await events().update({ status }).eq("id", id).is("disposition", null)
    },
    startRecording: startCallRecording,
    async downloadRecording(url) {
      const res = await fetch(url, { signal: AbortSignal.timeout(40_000) })
      if (!res.ok) throw new Error(`recording download failed (${res.status})`)
      return res.arrayBuffer()
    },
    async uploadRecording(path, bytes) {
      const { error } = await supabase.storage
        .from("call-recordings")
        .upload(path, bytes, { contentType: "audio/mpeg", upsert: true })
      if (error) throw new Error(error.message)
    },
    async saveRecording(id, path, seconds) {
      const { error } = await events().update({ recording_path: path, recording_seconds: seconds }).eq("id", id)
      if (error) throw new Error(error.message)
    },
  }
}

// Telnyx sends call lifecycle + message events here.
// Set this URL in Telnyx Portal → Connections → your connection → Webhook URL.
export async function POST(req: NextRequest) {
  const rawBody = await req.text()

  // TELNYX_PUBLIC_KEY comes from Telnyx Portal → Keys & Credentials → Public Key. A wrong key would
  // reject every call and SMS event, so failures are only logged until TELNYX_WEBHOOK_ENFORCE=true.
  const publicKey = process.env.TELNYX_PUBLIC_KEY
  if (
    publicKey &&
    !isValidTelnyxSignature(
      rawBody,
      req.headers.get("telnyx-signature-ed25519"),
      req.headers.get("telnyx-timestamp"),
      publicKey,
    )
  ) {
    console.error("telnyx webhook: signature check failed")
    if (process.env.TELNYX_WEBHOOK_ENFORCE === "true") {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
    }
  }

  let body: Record<string, unknown>
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const event = (body.data as Record<string, unknown> | undefined)?.event_type as string | undefined
  const payload = (body.data as Record<string, unknown> | undefined)?.payload as Record<string, unknown> | undefined

  if (!event || !payload) {
    return NextResponse.json({ ok: true })
  }

  const supabase = createAdminClient()

  // ── Voice call events ──────────────────────────────────────────────────────

  if (event.startsWith("call.")) {
    const result = await handleCallEvent(event, payload, callEventDeps(supabase))
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  // ── SMS / MMS events ───────────────────────────────────────────────────────

  if (event === "message.received") {
    const from = (payload.from as Record<string, string> | undefined)?.phone_number
    const toArr = payload.to as Array<{ phone_number: string }> | undefined
    const to = toArr?.[0]?.phone_number
    const text = payload.text as string | undefined

    if (!from || !text) return NextResponse.json({ ok: true })

    // Telnyx sends E.164, but normalise anyway. Short codes / alphanumeric
    // senders aren't phone numbers; they're kept as received and can't match.
    const normalised = toE164(from) ?? from

    // Match the broker on the normalised number, then get their lead — the
    // message still gets logged even when no match is found, so unknown
    // numbers show up in the inbox instead of being silently dropped.
    let { data: brokerRow } = await (supabase.from("brokers") as any)
      .select("id")
      .eq("phone_e164", normalised)
      .limit(1)
      .maybeSingle()

    // Brokers saved before phone_e164 existed (or by a writer that didn't
    // fill it) are found by their raw phone, and fixed so the next message
    // matches directly.
    if (!brokerRow) {
      const { data: legacy } = await (supabase.from("brokers") as any)
        .select("id, phone")
        .is("phone_e164", null)
        .or(`phone.eq.${from},phone.eq.${normalised}`)
        .limit(1)
        .maybeSingle()
      if (legacy && toE164((legacy as { phone: string | null }).phone) === normalised) {
        brokerRow = { id: (legacy as { id: string }).id }
        await (supabase.from("brokers") as any).update({ phone_e164: normalised }).eq("id", brokerRow.id)
      }
    }

    let leadId: string | null = null
    let agentIdForLog: string | null = null

    if (brokerRow) {
      const { data: leadRow } = await (supabase.from("leads") as any)
        .select("id, assigned_agent_id")
        .eq("broker_id", (brokerRow as { id: string }).id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      const lead = leadRow as { id: string; assigned_agent_id: string | null } | null
      leadId = lead?.id ?? null
      agentIdForLog = lead?.assigned_agent_id ?? null
    }

    // outreach_events.agent_id is required even for unlinked messages —
    // attribute to any existing agent so the row can still be inserted.
    if (!agentIdForLog) {
      const { data: fallbackAgent } = await (supabase.from("agents") as any)
        .select("id")
        .limit(1)
        .maybeSingle()
      agentIdForLog = (fallbackAgent as { id: string } | null)?.id ?? null
    }

    if (!agentIdForLog) return NextResponse.json({ ok: true })

    await (supabase.from("outreach_events") as any).insert({
      lead_id: leadId,
      agent_id: agentIdForLog,
      channel: "sms",
      status: "delivered",
      message_body: text,
      direction: "inbound",
      external_id: payload.id as string ?? null,
      from_number: normalised,
      to_number: (to ? toE164(to) ?? to : null),
    })
  }

  // message.finalized — update delivery status for outbound SMS
  if (event === "message.finalized") {
    const msgId = payload.id as string | undefined
    const toArr = payload.to as Array<{ status: string }> | undefined
    const status = toArr?.[0]?.status
    if (msgId && status) {
      // delivery_failed = the carrier refused it (e.g. "Not 10DLC registered");
      // sending_failed = Telnyx could not send it. Both are failures.
      const mapped =
        status === "delivered" ? "delivered" : status === "sending_failed" || status === "delivery_failed" ? "failed" : null
      if (mapped) {
        const errors = payload.errors as Array<{ title?: string; detail?: string; code?: string }> | undefined
        const reason = errors?.[0] ? [errors[0].code, errors[0].detail ?? errors[0].title].filter(Boolean).join(" ").slice(0, 300) : null
        await (supabase.from("outreach_events") as any)
          .update(mapped === "failed" ? { status: mapped, send_error: reason } : { status: mapped })
          .eq("external_id", msgId)
      }
    }
  }

  return NextResponse.json({ ok: true })
}
