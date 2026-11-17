// Pure rules for inbound callbacks: business hours, which lead a caller is, how a forwarded
// ring ended, and the voicemail script. No I/O, so scripts/_inbound-callback-tests.ts runs them.

export interface BusinessHours {
  enabled: boolean
  /** IANA zone the hours are written in, e.g. "America/Chicago". */
  timezone: string
  /** 0 = Sunday … 6 = Saturday. */
  openDays: number[]
  /** "HH:MM" (24h). */
  openTime: string
  closeTime: string
}

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

function minutesOf(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  return h <= 24 && min < 60 ? h * 60 + min : null
}

/** True when `now` falls inside the admin's hours. Hours turned off = always open. */
export function isWithinBusinessHours(hours: BusinessHours, now: Date): boolean {
  if (!hours.enabled) return true
  const open = minutesOf(hours.openTime)
  const close = minutesOf(hours.closeTime)
  if (open === null || close === null) return true // unreadable hours never block the forward
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: hours.timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now)
  } catch {
    return true // unknown time zone
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ""
  const day = WEEKDAY[get("weekday")]
  const mins = (Number(get("hour")) % 24) * 60 + Number(get("minute"))
  if (!hours.openDays.includes(day)) return false
  // Overnight hours (e.g. 20:00–02:00) wrap past midnight.
  return open <= close ? mins >= open && mins < close : mins >= open || mins < close
}

export interface LeadCandidate {
  leadId: string
  assignedAgentId: string | null
  createdAt: string
  /** Latest outbound agent call on this lead, if any. */
  lastCall: { at: string; agentId: string } | null
}

/**
 * Several leads can share a number. The most recently called one wins (that is who the broker is
 * calling back); with no calls at all, the newest lead. The agent is whoever made that last call,
 * else the lead's assigned agent.
 */
export function pickCallbackLead(candidates: LeadCandidate[]): { leadId: string; agentId: string | null } | null {
  if (candidates.length === 0) return null
  const sorted = candidates.slice().sort((a, b) => {
    const ca = a.lastCall ? Date.parse(a.lastCall.at) : -Infinity
    const cb = b.lastCall ? Date.parse(b.lastCall.at) : -Infinity
    if (ca !== cb) return cb - ca
    return Date.parse(b.createdAt) - Date.parse(a.createdAt)
  })
  const best = sorted[0]
  return { leadId: best.leadId, agentId: best.lastCall?.agentId ?? best.assignedAgentId }
}

export type MissedReason =
  | "no_answer"
  | "busy"
  | "declined"
  | "after_hours"
  | "no_forward_number"
  | "caller_hung_up"
  | "forward_failed"

/** Why the forwarded ring to the admin's phone ended without an answer. */
export function forwardMissReason(hangupCause: string | undefined): MissedReason {
  switch (hangupCause) {
    case "timeout":
    case "no_answer":
    case "normal_clearing":
      return "no_answer"
    case "busy":
    case "user_busy":
      return "busy"
    case "call_rejected":
      return "declined"
    case "originator_cancel":
      return "caller_hung_up"
    default:
      return "forward_failed"
  }
}

export const MISSED_REASON_LABEL: Record<string, string> = {
  no_answer: "No answer",
  busy: "Busy",
  declined: "Declined",
  after_hours: "After hours",
  no_forward_number: "No forwarding number set",
  caller_hung_up: "Caller hung up while ringing",
  forward_failed: "Forwarding failed",
}

export const DEFAULT_GREETING =
  "Thanks for calling Loadlinkers. We missed your call. This message will be recorded. Please leave your name and a short message after the beep, and we will call you back."

export function voicemailScript(vars: { brokerName: string | null; agentFirstName: string | null; callbackNumber: string | null }): string {
  const broker = vars.brokerName?.trim() || "there"
  const agent = vars.agentFirstName?.trim() || "[your name]"
  const num = vars.callbackNumber?.trim() || "[callback number]"
  return `Hi ${broker}, this is ${agent} from Loadlinkers. We help freight brokers issue rate confirmations. Please call me back at ${num}. Again, that's ${num}. Thank you.`
}
