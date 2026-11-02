// Broker cooldown (agents only): after MAX_UNANSWERED_TRIES unanswered call
// attempts in a row on one broker, nobody may call again for COOLDOWN_MINUTES
// after the latest attempt. Attempts are counted across every lead, agent and
// the admin for that broker, manual and AI calls alike. Pure: `now` is passed in.

export const MAX_UNANSWERED_TRIES = 2
export const COOLDOWN_MINUTES = 60

const COOLDOWN_MS = COOLDOWN_MINUTES * 60_000

export interface CallAttempt {
  at: Date
  unanswered: boolean
}

/** No answer, voicemail and wrong number are saved as `no_answer`; a call still `pending` or `failed` never connected. */
export function isUnansweredStatus(status: string | null | undefined): boolean {
  return status === "no_answer" || status === "pending" || status === "failed"
}

export interface CooldownResult {
  blocked: boolean
  /** When the broker may be called again (blocked only). */
  until: Date | null
  /** Unanswered attempts in the current streak. */
  streak: number
}

export function evaluateCooldown(attempts: CallAttempt[], now: Date): CooldownResult {
  const sorted = attempts.slice().sort((a, b) => b.at.getTime() - a.at.getTime()) // newest first
  let streak = 0
  let prev: CallAttempt | null = null
  for (const a of sorted) {
    if (!a.unanswered) break // a real conversation ends the streak
    if (prev && prev.at.getTime() - a.at.getTime() >= COOLDOWN_MS) break // a gap of an hour starts fresh
    streak++
    prev = a
  }
  if (streak >= MAX_UNANSWERED_TRIES) {
    const until = new Date(sorted[0].at.getTime() + COOLDOWN_MS)
    if (now.getTime() < until.getTime()) return { blocked: true, until, streak }
  }
  return { blocked: false, until: null, streak }
}

export function cooldownMessage(clock: string, minutes: number): string {
  return `Cooldown: this broker was tried twice without an answer. Try again at ${clock} (in ${minutes} min).`
}
