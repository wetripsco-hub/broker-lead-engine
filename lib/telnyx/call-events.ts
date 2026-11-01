// Voice events from the Telnyx webhook, for calls an agent places in the browser.
// The dialer creates the outreach_events row first and sends its id in client_state,
// so everything about one call (status, transcript, outcome, recording) lands on one row.
// AI calls never come through here: they have no row with channel = 'call'.
//
// Database and network access is passed in (deps) so scripts/_call-recording-tests.ts can
// run this without Telnyx or Supabase.

export interface CallRow {
  id: string
  status: string
  disposition: string | null
  recording_path: string | null
}

export interface ClientState {
  leadId: string | null
  agentId: string | null
  eventId: string | null
}

export interface CallEventDeps {
  /** The call row already linked to this Telnyx call. */
  findByExternalId(callControlId: string): Promise<CallRow | null>
  /** Links the dialer's row to this Telnyx call. Null when the row is not this agent's or is already linked. */
  linkEvent(eventId: string, agentId: string, callControlId: string): Promise<CallRow | null>
  /** Tabs still running the previous version send no eventId. */
  insertLegacyRow(leadId: string, agentId: string, callControlId: string): Promise<void>
  /** Never touches a row whose outcome the agent has already saved. */
  updateStatus(id: string, status: "answered" | "no_answer"): Promise<void>
  startRecording(callControlId: string): Promise<void>
  downloadRecording(url: string): Promise<ArrayBuffer>
  uploadRecording(path: string, bytes: ArrayBuffer): Promise<void>
  saveRecording(id: string, path: string, seconds: number | null): Promise<void>
}

export type CallEventResult = { ok: true } | { ok: false; error: string }

export function decodeClientState(raw: string | undefined): ClientState {
  const empty: ClientState = { leadId: null, agentId: null, eventId: null }
  if (!raw) return empty
  try {
    const decoded = JSON.parse(Buffer.from(raw, "base64").toString("utf-8"))
    return { leadId: decoded.leadId ?? null, agentId: decoded.agentId ?? null, eventId: decoded.eventId ?? null }
  } catch {
    return empty // malformed client_state
  }
}

/** A hang-up after the call was answered stays answered, whatever the cause says. */
export function hangupStatus(cause: string, currentStatus: string): "answered" | "no_answer" {
  return cause === "normal_clearing" || currentStatus === "answered" ? "answered" : "no_answer"
}

export function recordingPath(eventId: string, at: Date): string {
  const mm = String(at.getUTCMonth() + 1).padStart(2, "0")
  return `${at.getUTCFullYear()}/${mm}/${eventId}.mp3`
}

export function recordingSeconds(startedAt: unknown, endedAt: unknown): number | null {
  if (typeof startedAt !== "string" || typeof endedAt !== "string") return null
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime()
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 1000) : null
}

export async function handleCallEvent(
  event: string,
  payload: Record<string, unknown>,
  deps: CallEventDeps,
  now: Date = new Date(),
): Promise<CallEventResult> {
  const callControlId = payload.call_control_id as string | undefined
  if (!callControlId) return { ok: true }
  const { leadId, agentId, eventId } = decodeClientState(payload.client_state as string | undefined)

  // Webhooks can overtake each other, so any event may be the first one to arrive for a call.
  const findRow = async (): Promise<CallRow | null> => {
    const row = await deps.findByExternalId(callControlId)
    if (row || !eventId || !agentId) return row
    return deps.linkEvent(eventId, agentId, callControlId)
  }

  if (event === "call.initiated") {
    const row = await findRow()
    if (!row && !eventId && leadId && agentId) await deps.insertLegacyRow(leadId, agentId, callControlId)
    return { ok: true }
  }

  if (event === "call.answered") {
    const row = await findRow()
    if (!row) return { ok: true }
    await deps.updateStatus(row.id, "answered")
    // A recording problem must never fail the webhook or the call.
    try {
      await deps.startRecording(callControlId)
    } catch (e) {
      console.error("record_start failed", e)
    }
    return { ok: true }
  }

  if (event === "call.hangup") {
    const row = await findRow()
    if (row) await deps.updateStatus(row.id, hangupStatus((payload.hangup_cause as string | undefined) ?? "", row.status))
    return { ok: true }
  }

  if (event === "call.recording.saved") {
    const row = await findRow()
    if (!row) {
      console.error("recording saved for an unknown call", callControlId)
      return { ok: true }
    }
    if (row.recording_path) return { ok: true } // Telnyx retried

    const urls = payload.recording_urls as Record<string, string> | undefined
    const publicUrls = payload.public_recording_urls as Record<string, string> | undefined
    const url = urls?.mp3 ?? publicUrls?.mp3
    if (!url) {
      console.error("recording saved without an mp3 link", callControlId)
      return { ok: true }
    }

    // The link dies after 10 minutes. A non-2xx makes Telnyx send the event again.
    try {
      const bytes = await deps.downloadRecording(url)
      const path = recordingPath(row.id, now)
      await deps.uploadRecording(path, bytes)
      await deps.saveRecording(row.id, path, recordingSeconds(payload.recording_started_at, payload.recording_ended_at))
    } catch (e) {
      console.error("recording store failed", e)
      return { ok: false, error: "recording store failed" }
    }
  }

  return { ok: true }
}
