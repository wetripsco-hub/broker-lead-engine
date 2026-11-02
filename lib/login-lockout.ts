// Sign-in lockout: after MAX_FAILED_LOGINS wrong passwords in a row for one
// email, that email can't sign in for LOCKOUT_MINUTES. Failures older than
// FAILURE_WINDOW_MINUTES are forgotten, and a successful sign-in clears them.
// Pure: the stored row and the instant are passed in.

export const MAX_FAILED_LOGINS = 5
export const LOCKOUT_MINUTES = 5
export const FAILURE_WINDOW_MINUTES = 15

const MIN = 60_000

export interface LockoutRow {
  failed_count: number
  first_failed_at: string | null
  locked_until: string | null
}

/** Emails are compared trimmed and lower-case, so "Ali@X.com " and "ali@x.com" share one counter. */
export function normaliseLoginEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** Is this email locked right now? */
export function lockedUntil(row: LockoutRow | null, now: Date): Date | null {
  if (!row?.locked_until) return null
  const until = new Date(row.locked_until)
  return until.getTime() > now.getTime() ? until : null
}

/** The row after one more wrong password, and whether that locked the email. */
export function registerFailure(row: LockoutRow | null, now: Date): { row: LockoutRow; locked: boolean; triesLeft: number } {
  const fresh =
    !row ||
    !row.first_failed_at ||
    now.getTime() - new Date(row.first_failed_at).getTime() > FAILURE_WINDOW_MINUTES * MIN ||
    // A lock that has run out starts a new count.
    (!!row.locked_until && new Date(row.locked_until).getTime() <= now.getTime())
  const count = (fresh ? 0 : row!.failed_count) + 1
  const firstAt = fresh ? now.toISOString() : row!.first_failed_at!
  if (count >= MAX_FAILED_LOGINS) {
    return {
      row: { failed_count: count, first_failed_at: firstAt, locked_until: new Date(now.getTime() + LOCKOUT_MINUTES * MIN).toISOString() },
      locked: true,
      triesLeft: 0,
    }
  }
  return { row: { failed_count: count, first_failed_at: firstAt, locked_until: null }, locked: false, triesLeft: MAX_FAILED_LOGINS - count }
}

export function lockedMessage(until: Date, now: Date): string {
  const secs = Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 1000))
  const wait = secs >= 60 ? `${Math.ceil(secs / 60)} min` : `${secs} sec`
  return `Too many wrong passwords. Sign-in is locked for this email — try again in ${wait}.`
}

export function wrongPasswordMessage(triesLeft: number): string {
  return triesLeft === 1
    ? `Wrong email or password. 1 try left before sign-in is locked for ${LOCKOUT_MINUTES} minutes.`
    : `Wrong email or password. ${triesLeft} tries left before sign-in is locked for ${LOCKOUT_MINUTES} minutes.`
}
