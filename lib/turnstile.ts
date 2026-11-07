// Cloudflare Turnstile (bot check) — server-side verification.
// Off until TURNSTILE_SECRET_KEY (server) and NEXT_PUBLIC_TURNSTILE_SITE_KEY (browser)
// are both set in Vercel; with them unset the login and Contact Support forms work as before.

export const TURNSTILE_FIELD = "cf-turnstile-response"
export const TURNSTILE_FAILED = "Security check failed. Please wait a moment and try again."

export function turnstileEnabled(): boolean {
  return !!process.env.TURNSTILE_SECRET_KEY && !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
}

type Fetch = typeof fetch

/**
 * true = the token is valid (or Turnstile is not configured).
 * A missing token or Cloudflare saying "no" is rejected. If Cloudflare can't be
 * reached at all the request is let through, so an outage there can't lock
 * everyone out (the login lockout and IP rate limit still apply).
 */
export async function verifyTurnstile(token: string | null | undefined, ip: string | null, doFetch: Fetch = fetch): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret || !process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) return true
  if (!token || token.length > 2048) return false
  const body = new URLSearchParams({ secret, response: token })
  if (ip && ip !== "unknown") body.set("remoteip", ip)
  try {
    const res = await doFetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    })
    if (!res.ok) return true
    const json = (await res.json()) as { success?: boolean }
    return json.success === true
  } catch {
    return true
  }
}
