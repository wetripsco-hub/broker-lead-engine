// Inbound calls to our Telnyx number (Call Control application → /api/telnyx/inbound).
//
//   caller rings ─► log a callback row, match the lead
//     inside business hours + forwarding number set ─► transfer (ring the admin's phone N seconds)
//         answered ─► bridged, status "answered"
//         no answer / busy / declined ─► answer the caller ─► greeting ─► beep ─► record
//     outside hours / no forwarding number ─► answer ─► greeting ─► beep ─► record
//   recording saved ─► copy to storage, transcribe, status "voicemail", notify the admin
//
// Telnyx retries webhooks and may deliver them out of order, so every step is idempotent:
// rows are keyed on the caller leg's call_control_id, status changes are conditional on the
// current status, and every Telnyx command carries a fixed command_id (Telnyx ignores a repeat).
//
// Database and network access is passed in (deps) so scripts/_inbound-callback-tests.ts can run it.

import { toE164 } from "@/lib/phone"
import { telnyxSignatureProblem } from "@/lib/telnyx/webhook-signature"
import { forwardMissReason, isWithinBusinessHours, type BusinessHours, type MissedReason } from "@/lib/callbacks/rules"

export type CallbackStatus = "ringing" | "forwarding" | "answered" | "missed" | "voicemail"

export interface CallbackRow {
  id: string
  call_control_id: string
  status: CallbackStatus
  missed_reason: string | null
  lead_id: string | null
  ended_at: string | null
  recording_started_at: string | null
  recording_path: string | null
  admin_notified_at: string | null
}

export interface InboundSettings {
  forwardTo: string | null
  ringTimeoutSecs: number
  hours: BusinessHours
  greeting: string
}

export interface NewCallback {
  call_control_id: string
  call_session_id: string | null
  caller_number: string | null
  to_number: string | null
  lead_id: string | null
  agent_id: string | null
  received_at: string
}

export interface InboundDeps {
  findByCallControlId(callControlId: string): Promise<CallbackRow | null>
  findById(id: string): Promise<CallbackRow | null>
  /** Insert-or-nothing on call_control_id; returns the row either way. */
  insertCallback(row: NewCallback): Promise<CallbackRow>
  /** Updates only when the row's status is one of `fromStatuses` (when given). Null = not updated. */
  updateCallback(id: string, patch: Record<string, unknown>, fromStatuses?: CallbackStatus[]): Promise<CallbackRow | null>
  matchCaller(e164: string): Promise<{ leadId: string; agentId: string | null } | null>
  loadSettings(): Promise<InboundSettings>
  transfer(callControlId: string, opts: { to: string; timeoutSecs: number; targetLegClientState: string; commandId: string }): Promise<void>
  answer(callControlId: string, commandId: string): Promise<void>
  speak(callControlId: string, text: string, commandId: string): Promise<void>
  recordStart(callControlId: string, commandId: string): Promise<void>
  downloadRecording(url: string): Promise<ArrayBuffer>
  uploadRecording(path: string, bytes: ArrayBuffer): Promise<void>
  transcribe(bytes: ArrayBuffer): Promise<{ text: string; seconds: number | null }>
  /** Sets admin_notified_at only if still empty. True = this call won the claim. */
  claimNotification(id: string, at: string): Promise<boolean>
  /** Sends the admin email; only called after a successful claim. */
  notifyAdmin(callbackId: string): Promise<void>
}

export type InboundResult = { ok: true; note?: string } | { ok: false; error: string }

const FORWARD_KIND = "cbfwd"

export function encodeForwardState(callbackId: string): string {
  return Buffer.from(JSON.stringify({ k: FORWARD_KIND, id: callbackId })).toString("base64")
}

export function decodeForwardState(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null
  try {
    const d = JSON.parse(Buffer.from(raw, "base64").toString("utf-8"))
    return d?.k === FORWARD_KIND && typeof d.id === "string" ? d.id : null
  } catch {
    return null
  }
}

/** Signature check for this route. Unlike the older webhook, it is always enforced. */
export function inboundSignatureProblem(
  rawBody: string,
  signature: string | null,
  timestamp: string | null,
  publicKey: string | undefined,
  now: Date = new Date(),
): string | null {
  if (!publicKey) return "TELNYX_PUBLIC_KEY is not set"
  return telnyxSignatureProblem(rawBody, signature, timestamp, publicKey, now)
}

export function voicemailPath(callbackId: string, at: Date): string {
  const mm = String(at.getUTCMonth() + 1).padStart(2, "0")
  return `callbacks/${at.getUTCFullYear()}/${mm}/${callbackId}.mp3`
}

function seconds(startedAt: unknown, endedAt: unknown): number | null {
  if (typeof startedAt !== "string" || typeof endedAt !== "string") return null
  const ms = Date.parse(endedAt) - Date.parse(startedAt)
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 1000) : null
}

const CMD = {
  transfer: "cb-transfer",
  answer: "cb-answer",
  greeting: "cb-greeting",
  record: "cb-record",
} as const

/** Telnyx command failures (call already gone, etc.) must never fail the webhook. */
async function safely(what: string, fn: () => Promise<void>): Promise<boolean> {
  try {
    await fn()
    return true
  } catch (e) {
    console.error(`inbound: ${what} failed`, e)
    return false
  }
}

async function goToVoicemail(callControlId: string, deps: InboundDeps): Promise<void> {
  await safely("answer", () => deps.answer(callControlId, CMD.answer))
}

/** Claims the one admin notification for this row, then sends it. */
async function notifyOnce(row: CallbackRow, deps: InboundDeps, now: Date): Promise<void> {
  if (row.admin_notified_at) return
  if (!(await deps.claimNotification(row.id, now.toISOString()))) return
  await safely("notify admin", () => deps.notifyAdmin(row.id))
}

export async function handleInboundEvent(
  event: string,
  payload: Record<string, unknown>,
  deps: InboundDeps,
  now: Date = new Date(),
): Promise<InboundResult> {
  const callControlId = payload.call_control_id as string | undefined
  if (!callControlId) return { ok: true, note: "no call_control_id" }

  const forwardOf = decodeForwardState(payload.client_state)
  if (forwardOf) return handleForwardLeg(event, payload, forwardOf, callControlId, deps, now)

  // ── The caller's leg ─────────────────────────────────────────────────────

  if (event === "call.initiated") {
    if (payload.direction !== "incoming") return { ok: true, note: "not an inbound call" }
    let row = await deps.findByCallControlId(callControlId)
    if (!row) {
      const rawFrom = typeof payload.from === "string" ? payload.from : null
      const e164 = toE164(rawFrom)
      const rawTo = typeof payload.to === "string" ? payload.to : null
      let match: { leadId: string; agentId: string | null } | null = null
      if (e164) {
        try {
          match = await deps.matchCaller(e164)
        } catch (e) {
          console.error("inbound: lead match failed", e) // still log the call as unknown
        }
      }
      row = await deps.insertCallback({
        call_control_id: callControlId,
        call_session_id: (payload.call_session_id as string | undefined) ?? null,
        caller_number: e164 ?? rawFrom,
        to_number: toE164(rawTo) ?? rawTo,
        lead_id: match?.leadId ?? null,
        agent_id: match?.agentId ?? null,
        received_at: now.toISOString(),
      })
    }

    if (row.status === "forwarding") return { ok: true, note: "already forwarding" } // retried webhook
    if (row.status === "missed" && !row.recording_started_at) {
      await goToVoicemail(callControlId, deps) // retried webhook; same command_id
      return { ok: true, note: "voicemail" }
    }
    if (row.status !== "ringing") return { ok: true }

    const settings = await deps.loadSettings()
    const forwardTo = toE164(settings.forwardTo)
    const open = isWithinBusinessHours(settings.hours, now)
    if (!open || !forwardTo) {
      const reason: MissedReason = !open ? "after_hours" : "no_forward_number"
      await deps.updateCallback(row.id, { status: "missed", missed_reason: reason }, ["ringing"])
      await goToVoicemail(callControlId, deps)
      return { ok: true, note: reason }
    }

    const claimed = await deps.updateCallback(row.id, { status: "forwarding", forward_to: forwardTo }, ["ringing"])
    if (!claimed) return { ok: true }
    const sent = await safely("transfer", () =>
      deps.transfer(callControlId, {
        to: forwardTo,
        timeoutSecs: settings.ringTimeoutSecs,
        targetLegClientState: encodeForwardState(row!.id),
        commandId: CMD.transfer,
      }),
    )
    if (!sent) {
      await deps.updateCallback(row.id, { status: "missed", missed_reason: "forward_failed" }, ["forwarding"])
      await goToVoicemail(callControlId, deps)
      return { ok: true, note: "forward_failed" }
    }
    return { ok: true, note: "forwarding" }
  }

  const row = await deps.findByCallControlId(callControlId)
  if (!row) return { ok: true, note: "unknown call" }

  if (event === "call.answered") {
    // Only our own answer (voicemail path) plays the greeting.
    if (row.status !== "missed" || row.recording_started_at) return { ok: true }
    const settings = await deps.loadSettings()
    await deps.updateCallback(row.id, { greeting_started_at: now.toISOString() }, ["missed"])
    const spoke = await safely("speak", () => deps.speak(callControlId, settings.greeting, CMD.greeting))
    if (!spoke) {
      // No greeting is better than no voicemail: go straight to the beep.
      await safely("record_start", () => deps.recordStart(callControlId, CMD.record))
      await deps.updateCallback(row.id, { recording_started_at: now.toISOString() }, ["missed"])
    }
    return { ok: true, note: "greeting" }
  }

  if (event === "call.speak.ended") {
    if (row.status !== "missed" || row.recording_started_at || row.ended_at) return { ok: true }
    const started = await safely("record_start", () => deps.recordStart(callControlId, CMD.record))
    if (started) await deps.updateCallback(row.id, { recording_started_at: now.toISOString() }, ["missed"])
    return { ok: true, note: "recording" }
  }

  if (event === "call.hangup") {
    let current = (await deps.updateCallback(row.id, { ended_at: now.toISOString() }, undefined)) ?? row
    if (current.status === "ringing" || current.status === "forwarding") {
      // The caller gave up before anyone (or the voicemail) answered.
      current =
        (await deps.updateCallback(row.id, { status: "missed", missed_reason: "caller_hung_up" }, ["ringing", "forwarding"])) ??
        (await deps.findById(row.id)) ??
        current
    }
    // Missed without a voicemail: tell the admin now. With a recording, recording.saved does it.
    if (current.status === "missed" && !current.recording_started_at) await notifyOnce(current, deps, now)
    return { ok: true }
  }

  if (event === "call.recording.saved") {
    if (row.recording_path) return { ok: true, note: "already stored" } // Telnyx retried
    const urls = payload.recording_urls as Record<string, string> | undefined
    const publicUrls = payload.public_recording_urls as Record<string, string> | undefined
    const url = urls?.mp3 ?? publicUrls?.mp3
    if (!url) {
      console.error("inbound: recording saved without an mp3 link", callControlId)
      return { ok: true }
    }
    // The link dies after 10 minutes; a non-2xx makes Telnyx send the event again.
    let bytes: ArrayBuffer
    const path = voicemailPath(row.id, now)
    try {
      bytes = await deps.downloadRecording(url)
      await deps.uploadRecording(path, bytes)
    } catch (e) {
      console.error("inbound: voicemail store failed", e)
      return { ok: false, error: "voicemail store failed" }
    }
    const secs = seconds(payload.recording_started_at, payload.recording_ended_at)
    const saved = await deps.updateCallback(row.id, {
      status: "voicemail",
      recording_path: path,
      recording_seconds: secs,
      transcript_status: "pending",
    })
    let transcriptPatch: Record<string, unknown>
    try {
      const t = await deps.transcribe(bytes)
      const text = t.text.trim()
      transcriptPatch = {
        transcript: text || null,
        transcript_status: text ? "done" : "empty",
        ...(secs === null && t.seconds !== null ? { recording_seconds: Math.round(t.seconds) } : {}),
      }
    } catch (e) {
      console.error("inbound: transcription failed", e)
      transcriptPatch = { transcript_status: "failed" }
    }
    const final = (await deps.updateCallback(row.id, transcriptPatch)) ?? saved ?? row
    await notifyOnce(final, deps, now)
    return { ok: true, note: "voicemail saved" }
  }

  return { ok: true }
}

async function handleForwardLeg(
  event: string,
  payload: Record<string, unknown>,
  callbackId: string,
  forwardCallControlId: string,
  deps: InboundDeps,
  now: Date,
): Promise<InboundResult> {
  const row = await deps.findById(callbackId)
  if (!row) return { ok: true, note: "unknown callback" }

  if (event === "call.initiated") {
    await deps.updateCallback(row.id, { forward_call_control_id: forwardCallControlId })
    return { ok: true }
  }

  if (event === "call.answered") {
    await deps.updateCallback(row.id, { status: "answered", answered_at: now.toISOString() }, ["forwarding"])
    return { ok: true, note: "answered" }
  }

  if (event === "call.hangup") {
    if (row.status !== "forwarding") return { ok: true } // answered call ended, or already handled
    const reason = forwardMissReason(payload.hangup_cause as string | undefined)
    const moved = await deps.updateCallback(row.id, { status: "missed", missed_reason: reason }, ["forwarding"])
    if (!moved) return { ok: true }
    // The caller is still on the line (the failed transfer leaves their leg up): take a message.
    if (reason !== "caller_hung_up") await goToVoicemail(row.call_control_id, deps)
    return { ok: true, note: reason }
  }

  return { ok: true }
}
