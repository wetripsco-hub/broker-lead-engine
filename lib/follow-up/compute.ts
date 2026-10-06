import { FOLLOW_UP_DAYS, USE_BUSINESS_DAYS } from "./config"

const DAY_MS = 86_400_000

/** One row of the `leads_with_followup` view. */
export interface FollowUpRow {
  lead_id: string
  stage: string
  follow_up_snoozed_until: string | null
  last_outbound_email_at: string | null
  last_inbound_email_at: string | null
  replied: boolean
  follow_up_count: number
}

export interface FollowUpInfo {
  lastEmailAt: string
  /** Elapsed days since the last outbound email (business days if enabled). */
  days: number
  replied: boolean
  due: boolean
  /** Follow-ups already sent in the current unanswered run. */
  followUpCount: number
}

/** Whole days between two instants; weekends skipped when `business` is true. */
export function elapsedDays(fromIso: string, now: Date, business = USE_BUSINESS_DAYS): number {
  const from = new Date(fromIso)
  if (!business) return Math.max(0, Math.floor((now.getTime() - from.getTime()) / DAY_MS))
  let days = 0
  const cursor = new Date(from.getTime() + DAY_MS)
  while (cursor <= now) {
    const dow = cursor.getDay()
    if (dow !== 0 && dow !== 6) days++
    cursor.setTime(cursor.getTime() + DAY_MS)
  }
  return days
}

export function evaluateFollowUp(row: FollowUpRow, now: Date): FollowUpInfo | null {
  if (!row.last_outbound_email_at) return null
  const days = elapsedDays(row.last_outbound_email_at, now)
  const snoozed = row.follow_up_snoozed_until != null && new Date(row.follow_up_snoozed_until) > now
  const due =
    !row.replied &&
    days >= FOLLOW_UP_DAYS &&
    row.stage !== "converted" &&
    row.stage !== "dead" &&
    !snoozed
  return {
    lastEmailAt: row.last_outbound_email_at,
    days,
    replied: row.replied,
    due,
    followUpCount: row.follow_up_count,
  }
}

/** "1st" / "2nd" / "3rd" / "4th" for the follow-up about to be sent. */
export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"]
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}

/** "Re: <previous subject>", without stacking "Re: Re:". */
export function followUpSubject(previous: string): string {
  return `Re: ${previous.replace(/^(re:\s*)+/i, "").trim()}`
}
