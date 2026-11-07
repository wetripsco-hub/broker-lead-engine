// Per-IP rate limiting, counted in Postgres (public.rate_limit_hit, service role
// only) so the limit holds across all serverless instances. If the counter can't
// be reached the request is allowed: a database blip must not lock everyone out.

export interface RateRule {
  bucket: string
  max: number
  windowSeconds: number
}

export const RULES = {
  // Server actions.
  login: { bucket: "login", max: 20, windowSeconds: 15 * 60 },
  sms: { bucket: "sms", max: 30, windowSeconds: 60 },
  // /api routes.
  supportRequest: { bucket: "api-support", max: 10, windowSeconds: 10 * 60 },
  calls: { bucket: "api-calls", max: 20, windowSeconds: 60 },
  cron: { bucket: "api-cron", max: 30, windowSeconds: 60 },
  api: { bucket: "api", max: 120, windowSeconds: 60 },
} satisfies Record<string, RateRule>

/**
 * Which limit applies to an /api path. null = not limited here: provider
 * webhooks (verified by signature, and bursty from a few provider IPs) and
 * email open/click tracking (many recipients share mail-proxy IPs).
 */
export function apiRuleFor(pathname: string): RateRule | null {
  if (!pathname.startsWith("/api/")) return null
  if (pathname.startsWith("/api/webhooks/") || pathname === "/api/telnyx/webhook" || pathname.startsWith("/api/track/")) return null
  if (pathname === "/api/support-request") return RULES.supportRequest
  if (pathname === "/api/telnyx/token" || pathname.startsWith("/api/ai-calls/start")) return RULES.calls
  if (pathname === "/api/ingest" || pathname === "/api/email/sync") return RULES.cron
  return RULES.api
}

/** Client IP as Vercel reports it (first x-forwarded-for entry). */
export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip")?.trim() || "unknown"
}

/** Counts this hit. true = allowed, false = over the limit (answer 429). */
export async function hitRateLimit(rule: RateRule, ip: string): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return true
  try {
    const res = await fetch(`${url}/rest/v1/rpc/rate_limit_hit`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_key: `${rule.bucket}:${ip}`, p_max: rule.max, p_window_seconds: rule.windowSeconds }),
      signal: AbortSignal.timeout(1500),
      cache: "no-store",
    })
    if (!res.ok) return true
    return (await res.json()) !== false
  } catch {
    return true
  }
}

/** For server actions: true when this caller's IP is over the limit. */
export async function actionOverLimit(rule: RateRule): Promise<boolean> {
  const { headers } = await import("next/headers")
  return !(await hitRateLimit(rule, clientIp(await headers())))
}

export const TOO_MANY = "Too many attempts. Please wait a few minutes and try again."
