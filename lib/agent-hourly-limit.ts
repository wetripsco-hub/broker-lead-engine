// Agents may place at most HOURLY_CALL_LIMIT manual calls in any rolling hour.
// Every attempt counts, answered or not. Pure: the instant is passed in.

export const HOURLY_CALL_LIMIT = 40
export const HOURLY_WINDOW_MINUTES = 60

const WINDOW_MS = HOURLY_WINDOW_MINUTES * 60_000

export interface HourlyLimitResult {
  /** Attempts in the last 60 minutes. */
  count: number
  blocked: boolean
  /** When the next call is allowed again (blocked only). */
  blockedUntil: Date | null
}

export function evaluateHourlyLimit(attempts: Date[], now: Date): HourlyLimitResult {
  const from = now.getTime() - WINDOW_MS
  const inWindow = attempts
    .map((d) => d.getTime())
    .filter((t) => t > from && t <= now.getTime())
    .sort((a, b) => b - a) // newest first
  const count = inWindow.length
  if (count < HOURLY_CALL_LIMIT) return { count, blocked: false, blockedUntil: null }
  // The limit lifts once the LIMIT-th most recent attempt leaves the hour.
  return { count, blocked: true, blockedUntil: new Date(inWindow[HOURLY_CALL_LIMIT - 1] + WINDOW_MS) }
}

/** Whole minutes from `now` until `until`, never below 1. */
export function minutesUntil(until: Date, now: Date): number {
  return Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 60_000))
}

export function hourlyLimitMessage(clock: string, minutes: number): string {
  return `Hourly limit reached (${HOURLY_CALL_LIMIT} calls in the last hour). You can call again at ${clock} (in ${minutes} min).`
}
