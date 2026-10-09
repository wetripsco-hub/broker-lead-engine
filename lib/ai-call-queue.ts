// Runs AI calls for a list of leads strictly one after another: start a call,
// wait until it has ended, record how it went, pause briefly, then the next lead.
// Everything outside is injected so the rules can be tested without a browser or
// a phone line. Every safety rule (consent, do-not-call, calling hours, daily cap,
// test mode, master switch) is enforced by the server in /api/ai-calls/start for
// EACH lead; this file only decides what to do with the answers.

export type QueueStatus = "waiting" | "calling" | "done" | "skipped" | "failed" | "stopped"

export interface QueueItem {
  leadId: string
  label: string
  status: QueueStatus
  /** Why it was skipped / failed, or a one-line result. */
  detail?: string
  durationSeconds?: number | null
  disposition?: string | null
  sentiment?: string | null
  summary?: string | null
}

export type StartResult =
  | { ok: true; eventId: string }
  | { ok: false; error: string; code?: string; status?: number }

export interface CallSnapshot {
  call_status: string | null
  status: string | null
  duration_seconds: number | null
  disposition: string | null
  sentiment: string | null
  ai_summary: string | null
}

export interface QueueDeps {
  startCall(leadId: string): Promise<StartResult>
  getCall(eventId: string): Promise<CallSnapshot | null>
  sleep(ms: number): Promise<void>
  /** Pause between one call ending and the next starting. */
  gapMs: number
  pollMs: number
  /** Give up waiting for one call's report after this long (the call itself is capped at 5 minutes). */
  maxWaitMs: number
}

/** Server answers that mean "no lead will work right now": stop the whole queue. */
export const ABORT_CODES = new Set(["disabled", "daily_cap", "not_configured", "provider_error"])

export const MAX_QUEUE = 50

export interface QueueSummary {
  total: number
  called: number
  answered: number
  skipped: number
  failed: number
  stopped: number
}

export function summarise(items: QueueItem[]): QueueSummary {
  const count = (s: QueueStatus) => items.filter((i) => i.status === s).length
  return {
    total: items.length,
    called: count("done"),
    answered: items.filter((i) => i.status === "done" && (i.durationSeconds ?? 0) > 0).length,
    skipped: count("skipped"),
    failed: count("failed"),
    stopped: count("stopped"),
  }
}

const ENDED = new Set(["ended", "failed"])

/**
 * Processes `items` in order. `onChange` is called with a fresh copy after every
 * step. `shouldStop()` is checked before each new call (a call already in
 * progress is never cut off). Resolves with the final list.
 */
export async function runAiCallQueue(
  initial: QueueItem[],
  deps: QueueDeps,
  onChange: (items: QueueItem[]) => void,
  shouldStop: () => boolean,
): Promise<QueueItem[]> {
  const items = initial.slice(0, MAX_QUEUE).map((i) => ({ ...i, status: "waiting" as QueueStatus }))
  const publish = () => onChange(items.map((i) => ({ ...i })))
  publish()

  let abortReason: string | null = null

  for (let i = 0; i < items.length; i++) {
    const item = items[i]

    if (abortReason || shouldStop()) {
      item.status = "stopped"
      item.detail = abortReason ?? "Stopped before this call"
      continue
    }

    item.status = "calling"
    item.detail = "Starting…"
    publish()

    let started: StartResult
    try {
      started = await deps.startCall(item.leadId)
    } catch {
      started = { ok: false, error: "Couldn't reach the server" }
    }

    if (!started.ok) {
      // Not signed in any more, or something that affects every lead: stop here.
      if (started.status === 401 || (started.code && ABORT_CODES.has(started.code))) {
        item.status = started.code === "provider_error" ? "failed" : "skipped"
        item.detail = started.error
        abortReason = `Queue stopped: ${started.error}`
      } else {
        item.status = "skipped"
        item.detail = started.error
      }
      publish()
      continue
    }

    item.detail = "Calling…"
    publish()

    // Wait for this call to end (the provider's report updates the same row).
    let waited = 0 // counted, not clocked, so the limit is exact and testable
    let snap: CallSnapshot | null = null
    for (;;) {
      await deps.sleep(deps.pollMs)
      waited += deps.pollMs
      try {
        snap = await deps.getCall(started.eventId)
      } catch {
        snap = null
      }
      if (snap && snap.call_status && ENDED.has(snap.call_status)) break
      if (waited >= deps.maxWaitMs) break
    }

    if (snap && snap.call_status === "failed") {
      item.status = "failed"
      item.detail = "The call couldn't be completed"
    } else if (snap && snap.call_status === "ended") {
      item.status = "done"
      item.durationSeconds = snap.duration_seconds
      item.disposition = snap.disposition
      item.sentiment = snap.sentiment
      item.summary = snap.ai_summary
      item.detail = (snap.duration_seconds ?? 0) > 0 ? "Call completed" : "No answer"
    } else {
      // No report within the time limit: don't block the rest of the queue on it.
      item.status = "failed"
      item.detail = "No result received for this call (it may still be recorded on the lead)"
    }
    publish()

    const hasNext = items.slice(i + 1).some(() => true)
    if (hasNext && !abortReason && !shouldStop()) await deps.sleep(deps.gapMs)
  }

  publish()
  return items.map((i) => ({ ...i }))
}
