// Login-screen "Contact Support" requests and the agent's own password change.
// Pure helpers (also imported by the browser) so they can be tested offline
// (scripts/_support-request-tests.ts).

export const MESSAGE_MAX = 1000
export const LOGIN_ID_MAX = 254
export const SUPPORT_RATE_LIMIT = 3 // requests per IP per hour
export const MIN_PASSWORD_LENGTH = 6

export const DEFAULT_SUPPORT_MESSAGE = "I forgot my password, please reset it."
/** Shown for every accepted request, whether or not the login ID exists. */
export const SUPPORT_SENT_MESSAGE = "Your request has been sent to the admin."

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

export function validateSupportRequest(input: { loginId?: unknown; message?: unknown }): Result<{ loginId: string; message: string }> {
  const loginId = typeof input.loginId === "string" ? input.loginId.trim().toLowerCase() : ""
  const message = typeof input.message === "string" ? input.message.trim() : ""
  if (!loginId) return { ok: false, error: "Enter your login ID." }
  if (loginId.length > LOGIN_ID_MAX) return { ok: false, error: "Login ID is too long." }
  if (!message) return { ok: false, error: "Write a message." }
  if (message.length > MESSAGE_MAX) return { ok: false, error: `Message must be ${MESSAGE_MAX} characters or less.` }
  return { ok: true, value: { loginId, message } }
}

export function isRateLimited(requestsInLastHour: number): boolean {
  return requestsInLastHour >= SUPPORT_RATE_LIMIT
}

export function validateNewPassword(current: string, next: string, confirm: string): string | null {
  if (!current) return "Enter your current password."
  if (next.length < MIN_PASSWORD_LENGTH) return `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`
  if (next === current) return "New password must be different from the current one."
  if (next !== confirm) return "New passwords do not match."
  return null
}
