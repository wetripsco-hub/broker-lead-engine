import { getCallStatus, resolveTimezone } from "@/lib/timezone/broker-time"

export interface AiCallSettings {
  enabled: boolean
  testMode: boolean
  testNumbers: string[]
  dailyCap: number
  /** Admins may be allowed to skip the calling-hours check (default false). */
  allowAdminHoursOverride: boolean
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
  /**
   * The caller asked to skip the calling-hours check. `isAdmin` must come from
   * a server-side lookup, never from anything the client sent.
   */
  hoursOverride?: { requested: boolean; isAdmin: boolean }
}

/** Why the calling-hours check was skipped, if it was. */
export type HoursExemption = "test_mode" | "admin_override" | null

export type GateResult =
  | { ok: true; hoursExemption: HoursExemption }
  | { ok: false; code: string; message: string }

const block = (code: string, message: string): GateResult => ({ ok: false, code, message })

/** Is `to` allowed to skip calling hours because test mode is on and it's a listed test number? */
export function isTestModeExempt(settings: AiCallSettings, to: string | null): boolean {
  return settings.testMode && !!to && settings.testNumbers.includes(to)
}
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

  // Test mode: only listed numbers may be called at all. (Never skipped.)
  if (i.settings.testMode && !i.settings.testNumbers.includes(i.to)) {
    return block("test_mode", "Test mode is on and this number isn't on the test-number list.")
  }

  // An override request must be valid on its own, even if the hours happen to
  // be fine: an agent (or an admin while the setting is off) asking to skip
  // the check is refused outright.
  const ovr = i.hoursOverride
  if (ovr?.requested) {
    if (!ovr.isAdmin) return block("override_not_allowed", "Only an admin can override calling hours.")
    if (!i.settings.allowAdminHoursOverride) {
      return block("override_disabled", "Calling-hours override is switched off in Settings → AI calling.")
    }
  }

  // Calling hours are skipped for a whitelisted number in test mode, or for an
  // admin who asked for the override while the setting allows it.
  let hoursExemption: HoursExemption = null
  if (isTestModeExempt(i.settings, i.to)) hoursExemption = "test_mode"
  else if (ovr?.requested && ovr.isAdmin && i.settings.allowAdminHoursOverride) hoursExemption = "admin_override"

  if (!hoursExemption) {
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
  }

  if (i.hasActiveCall) return block("active_call", "An AI call to this lead is already in progress.")
  if (i.callsInLast24h >= i.settings.dailyCap) {
    return block("daily_cap", `The daily AI-call cap (${i.settings.dailyCap}) has been reached.`)
  }
  return { ok: true, hoursExemption }
}
