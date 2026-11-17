import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { callCommand } from "@/lib/telnyx/client"
import {
  handleInboundEvent,
  inboundSignatureProblem,
  type CallbackRow,
  type CallbackStatus,
  type InboundDeps,
} from "@/lib/telnyx/inbound"
import {
  loadSettingsRow,
  matchCallerToLead,
  notifyAdminOfCallback,
  toInboundSettings,
  transcribeVoicemail,
} from "@/lib/callbacks/server"

// Inbound calls to our Telnyx number. Set as the webhook URL of the Call Control application
// the number is assigned to. Copying + transcribing a voicemail can take a while.
export const maxDuration = 60

const ROW = "id, call_control_id, status, missed_reason, lead_id, ended_at, recording_started_at, recording_path, admin_notified_at"

function deps(admin: ReturnType<typeof createAdminClient>): InboundDeps {
  const table = () => admin.from("callbacks") as any
  return {
    async findByCallControlId(id) {
      const { data } = await table().select(ROW).eq("call_control_id", id).maybeSingle()
      return (data as CallbackRow | null) ?? null
    },
    async findById(id) {
      const { data } = await table().select(ROW).eq("id", id).maybeSingle()
      return (data as CallbackRow | null) ?? null
    },
    async insertCallback(row) {
      // Two deliveries of call.initiated can race: the unique key keeps one row.
      const { error } = await table().upsert(row, { onConflict: "call_control_id", ignoreDuplicates: true })
      if (error) throw new Error(error.message)
      const { data } = await table().select(ROW).eq("call_control_id", row.call_control_id).single()
      return data as CallbackRow
    },
    async updateCallback(id, patch, fromStatuses?: CallbackStatus[]) {
      let q = table().update(patch).eq("id", id)
      if (fromStatuses) q = q.in("status", fromStatuses)
      const { data, error } = await q.select(ROW).maybeSingle()
      if (error) throw new Error(error.message)
      return (data as CallbackRow | null) ?? null
    },
    async claimNotification(id, at) {
      const { data } = await table().update({ admin_notified_at: at }).eq("id", id).is("admin_notified_at", null).select("id").maybeSingle()
      return !!data
    },
    matchCaller: (e164) => matchCallerToLead(admin, e164),
    loadSettings: async () => toInboundSettings(await loadSettingsRow(admin)),
    transfer: (id, o) =>
      callCommand(id, "transfer", {
        to: o.to,
        timeout_secs: o.timeoutSecs,
        from_display_name: "Loadlinkers callback",
        target_leg_client_state: o.targetLegClientState,
        command_id: o.commandId,
      }),
    answer: (id, commandId) => callCommand(id, "answer", { command_id: commandId }),
    speak: (id, text, commandId) =>
      callCommand(id, "speak", { payload: text.slice(0, 2900), voice: "female", language: "en-US", command_id: commandId }),
    recordStart: (id, commandId) =>
      callCommand(id, "record_start", {
        format: "mp3",
        channels: "single",
        play_beep: true,
        max_length: 180,
        timeout_secs: 8, // stop after 8 s of silence
        command_id: commandId,
      }),
    async downloadRecording(url) {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) })
      if (!res.ok) throw new Error(`recording download failed (${res.status})`)
      return res.arrayBuffer()
    },
    async uploadRecording(path, bytes) {
      const { error } = await admin.storage.from("call-recordings").upload(path, bytes, { contentType: "audio/mpeg", upsert: true })
      if (error) throw new Error(error.message)
    },
    transcribe: transcribeVoicemail,
    notifyAdmin: (id) => notifyAdminOfCallback(admin, id),
  }
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const problem = inboundSignatureProblem(
    rawBody,
    req.headers.get("telnyx-signature-ed25519"),
    req.headers.get("telnyx-timestamp"),
    process.env.TELNYX_PUBLIC_KEY,
  )
  if (problem) {
    console.error(`telnyx inbound: rejected: ${problem}`)
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
  }

  let body: { data?: { event_type?: string; payload?: Record<string, unknown> } }
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const event = body.data?.event_type
  const payload = body.data?.payload
  if (!event || !payload) return NextResponse.json({ ok: true })

  try {
    const result = await handleInboundEvent(event, payload, deps(createAdminClient()))
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(`telnyx inbound: ${event} failed`, e)
    return NextResponse.json({ error: "failed" }, { status: 500 })
  }
}
