import { getCallStatus, resolveTimezone } from "@/lib/timezone/broker-time"

export interface AiCallSettings {
  enabled: boolean
  testMode: boolean
  testNumbers: string[]
  dailyCap: number
}

export interface GateInput {
  settings: AiCallSettings
  lead: {
    aiCallConsent: boolean
    doNotCall: boolean
    state: string | null
    phone: string | null
  }
  /** Normalised E.164 destination, or null if the broker's phone is unusable. */
  to: string | null
  onDncList: boolean
  hasActiveCall: boolean
  /** AI calls started in the last 24 hours. */
  callsInLast24h: number
  now: Date
}

export type GateResult = { ok: true } | { ok: false; code: string; message: string }

const block = (code: string, message: string): GateResult => ({ ok: false, code, message })
const HOUR = 3600_000

/**
 * Every reason an AI call must not go out, checked server-side before the
 * provider is touched. Order matters only for which message the user sees.
 */
export function evaluateAiCallGate(i: GateInput): GateResult {
  if (!i.settings.enabled) return block("disabled", "AI calling is switched off. An admin can enable it in Settings → AI calling.")
  if (!i.to) return block("no_phone", "Invalid phone number: this broker has no valid phone on file.")
  if (i.lead.doNotCall) return block("do_not_call", "This lead is marked do-not-call.")
  if (i.onDncList) return block("dnc_list", "This phone number is on the do-not-call list.")
  if (!i.lead.aiCallConsent) return block("no_consent", "No AI-call consent is recorded for this lead. An admin must mark consent first.")

  // Calling window: 8 AM–6 PM, weekdays, in the broker's local time.
  const tz = resolveTimezone(i.lead.state, i.lead.phone)
  if (!tz) return block("unknown_timezone", "Can't work out the broker's local time, so the calling window can't be checked.")
  // For states split across zones the zone is a best guess, so the whole
  // window must hold an hour either side too.
  const probes = tz.approximate
    ? [i.now, new Date(i.now.getTime() - HOUR), new Date(i.now.getTime() + HOUR)]
    : [i.now]
  for (const t of probes) {
    const s = getCallStatus(tz.tz, t).state
    if (s === "weekend") return block("weekend", "It's the weekend in the broker's local time. AI calls go out Monday–Friday, 8 AM–6 PM.")
    if (s === "closed") return block("outside_hours", "It's outside 8 AM–6 PM in the broker's local time.")
  }

  if (i.hasActiveCall) return block("active_call", "An AI call to this lead is already in progress.")
  if (i.callsInLast24h >= i.settings.dailyCap) {
    return block("daily_cap", `The daily AI-call cap (${i.settings.dailyCap}) has been reached.`)
  }
  if (i.settings.testMode && !i.settings.testNumbers.includes(i.to)) {
    return block("test_mode", "Test mode is on and this number isn't on the test-number list.")
  }
  return { ok: true }
}
