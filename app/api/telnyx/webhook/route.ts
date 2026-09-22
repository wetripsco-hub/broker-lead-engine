import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"

// Telnyx sends call lifecycle + message events here.
// Set this URL in Telnyx Portal → Connections → your connection → Webhook URL.
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
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

  const callControlId = payload.call_control_id as string | undefined
  const clientState = payload.client_state as string | undefined

  let leadId: string | null = null
  let agentId: string | null = null
  if (clientState) {
    try {
      const decoded = JSON.parse(Buffer.from(clientState, "base64").toString("utf-8"))
      leadId = decoded.leadId ?? null
      agentId = decoded.agentId ?? null
    } catch {
      // ignore malformed client_state
    }
  }

  if (event === "call.initiated" && leadId && agentId) {
    await (supabase.from("outreach_events") as any).insert({
      lead_id: leadId,
      agent_id: agentId,
      channel: "call",
      status: "pending",
      direction: "outbound",
      external_id: callControlId ?? null,
    })
  }

  if (event === "call.answered" && callControlId) {
    await (supabase.from("outreach_events") as any)
      .update({ status: "answered" })
      .eq("external_id", callControlId)
  }

  if (event === "call.hangup" && callControlId) {
    const hangupCause = (payload.hangup_cause as string | undefined) ?? ""
    const status = hangupCause === "normal_clearing" ? "answered" : "no_answer"
    await (supabase.from("outreach_events") as any)
      .update({ status })
      .eq("external_id", callControlId)
  }

  if (event === "call.recording.saved" && callControlId) {
    const recordingUrl =
      (payload.public_recording_urls as Record<string, string> | undefined)?.mp3 ?? null
    if (recordingUrl) {
      await (supabase.from("outreach_events") as any)
        .update({ recording_url: recordingUrl })
        .eq("external_id", callControlId)
    }
  }

  // ── SMS / MMS events ───────────────────────────────────────────────────────

  if (event === "message.received") {
    const from = (payload.from as Record<string, string> | undefined)?.phone_number
    const text = payload.text as string | undefined

    if (!from || !text) return NextResponse.json({ ok: true })

    // Normalise phone: strip non-digits then reformat as E.164
    const digits = from.replace(/\D/g, "")
    const normalised = digits.length === 10 ? `+1${digits}` : `+${digits}`

    // Find broker whose phone matches, then get their lead
    const { data: brokerRow } = await (supabase.from("brokers") as any)
      .select("id")
      .or(`phone.eq.${from},phone.eq.${normalised}`)
      .maybeSingle()

    if (!brokerRow) {
      // Unknown sender — log and move on
      console.warn(`[telnyx/webhook] inbound SMS from unknown number: ${from}`)
      return NextResponse.json({ ok: true })
    }

    const { data: leadRow } = await (supabase.from("leads") as any)
      .select("id, assigned_agent_id")
      .eq("broker_id", (brokerRow as { id: string }).id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!leadRow) return NextResponse.json({ ok: true })

    const lead = leadRow as { id: string; assigned_agent_id: string | null }

    // Use assigned agent; fall back to first admin agent if unassigned
    let agentIdForLog = lead.assigned_agent_id
    if (!agentIdForLog) {
      const { data: adminAgent } = await (supabase.from("agents") as any)
        .select("id")
        .limit(1)
        .maybeSingle()
      agentIdForLog = (adminAgent as { id: string } | null)?.id ?? null
    }

    if (!agentIdForLog) return NextResponse.json({ ok: true })

    await (supabase.from("outreach_events") as any).insert({
      lead_id: lead.id,
      agent_id: agentIdForLog,
      channel: "sms",
      status: "delivered",
      message_body: text,
      direction: "inbound",
      external_id: payload.id as string ?? null,
    })
  }

  // message.finalized — update delivery status for outbound SMS
  if (event === "message.finalized") {
    const msgId = payload.id as string | undefined
    const toArr = payload.to as Array<{ status: string }> | undefined
    const status = toArr?.[0]?.status
    if (msgId && status) {
      const mapped =
        status === "delivered" ? "delivered" : status === "sending_failed" ? "failed" : null
      if (mapped) {
        await (supabase.from("outreach_events") as any)
          .update({ status: mapped })
          .eq("external_id", msgId)
      }
    }
  }

  return NextResponse.json({ ok: true })
}
