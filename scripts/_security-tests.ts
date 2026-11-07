// Security hardening checks.   npx tsx scripts/_security-tests.ts
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { RULES, apiRuleFor, clientIp } from "../lib/rate-limit"
import { verifyTurnstile } from "../lib/turnstile"
import { isAdminInDb } from "../lib/voice-agents/admin-check"

let failed = 0
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  ${extra}`}`)
  if (!ok) failed++
}
const read = (f: string) => readFileSync(f, "utf8")

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

async function main() {
  // ── Role never comes from user-editable user_metadata ──────────────────────
  const code = [...walk("app"), ...walk("lib"), ...walk("components"), "middleware.ts"]
  const offenders = code.filter((f) => /user_metadata\??\.role|user_metadata:\s*\{\s*role/.test(read(f)))
  check("no role read/written via user_metadata", offenders.length === 0, offenders.join(", "))
  check("new agents get the role in app_metadata", /app_metadata: \{ role: "agent" \}/.test(read("app/(dashboard)/agents/actions.ts")))
  const fake = (meta: Record<string, unknown>) => ({ auth: { admin: { getUserById: async () => ({ data: { user: meta }, error: null }) } } })
  check("isAdminInDb: app_metadata admin -> true", await isAdminInDb(fake({ app_metadata: { role: "admin" } }) as any, "u"))
  check("isAdminInDb: user_metadata admin only -> false", !(await isAdminInDb(fake({ user_metadata: { role: "admin" }, app_metadata: {} }) as any, "u")))

  // ── Migration ──────────────────────────────────────────────────────────────
  const mig = read("supabase/migrations/20261107000002_security_hardening.sql")
  check("migration: copies role to app_metadata", /raw_app_meta_data[\s\S]*jsonb_build_object\('role', raw_user_meta_data ->> 'role'\)/.test(mig))
  check("migration: is_admin reads app_metadata from auth.users", /function public\.is_admin\(\)[\s\S]*raw_app_meta_data ->> 'role'[\s\S]*auth\.users/.test(mig))
  const fns = ["set_updated_at", "current_agent_id", "is_admin", "handle_new_user", "create_lead_for_new_broker", "find_lead_for_email", "guard_lead_calling_flags", "guard_agent_ip_location", "guard_agent_comp", "record_customer_payment", "cancel_customer"]
  check("migration: search_path fixed on all 11 functions", fns.every((f) => new RegExp(`alter function public\\.${f}\\([^)]*\\) set search_path = public, pg_temp`).test(mig)))
  check("migration: trigger functions revoked from anon/authenticated", ["create_lead_for_new_broker", "handle_new_user"].every((f) => new RegExp(`revoke execute on function public\\.${f}\\(\\) from public, anon, authenticated`).test(mig)))
  check("migration: is_admin/current_agent_id revoked from anon, kept for authenticated", ["is_admin", "current_agent_id"].every((f) => new RegExp(`revoke execute on function public\\.${f}\\(\\) from public, anon;`).test(mig) && new RegExp(`grant execute on function public\\.${f}\\(\\) to authenticated`).test(mig)))
  check("migration: rate_limit_hit is service-role only", /revoke execute on function public\.rate_limit_hit[^;]*from public, anon, authenticated/.test(mig) && /grant execute on function public\.rate_limit_hit[^;]*to service_role/.test(mig))

  // ── Rate limiting ──────────────────────────────────────────────────────────
  check("rate: login page not limited by api rule", apiRuleFor("/login") === null)
  check("rate: webhooks exempt (signature-verified)", apiRuleFor("/api/telnyx/webhook") === null && apiRuleFor("/api/webhooks/voice/retell") === null)
  check("rate: tracking pixels exempt", apiRuleFor("/api/track/open") === null)
  check("rate: support request", apiRuleFor("/api/support-request") === RULES.supportRequest)
  check("rate: call token + AI call start", apiRuleFor("/api/telnyx/token") === RULES.calls && apiRuleFor("/api/ai-calls/start") === RULES.calls)
  check("rate: other api routes get the default", apiRuleFor("/api/copilot/suggest") === RULES.api && apiRuleFor("/api/leads/export") === RULES.api)
  check("rate: client ip from x-forwarded-for", clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" })) === "1.2.3.4")
  const mw = read("middleware.ts")
  check("rate: middleware answers 429", /apiRuleFor[\s\S]*hitRateLimit[\s\S]*status: 429/.test(mw))
  check("rate: login action limited per IP", /actionOverLimit\(RULES\.login\)/.test(read("app/(auth)/login/actions.ts")))
  check("rate: both SMS actions limited", /actionOverLimit\(RULES\.sms\)/.test(read("app/(dashboard)/leads/[id]/sms-actions.ts")) && /actionOverLimit\(RULES\.sms\)/.test(read("app/(dashboard)/messages/actions.ts")))

  // ── Turnstile ──────────────────────────────────────────────────────────────
  const ok = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch
  delete process.env.TURNSTILE_SECRET_KEY
  delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
  check("turnstile: not configured -> allowed (no behaviour change)", await verifyTurnstile("", null, ok({ success: false })))
  process.env.TURNSTILE_SECRET_KEY = "s"
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "k"
  check("turnstile: missing token -> rejected", !(await verifyTurnstile("", null, ok({ success: true }))))
  check("turnstile: valid token -> allowed", await verifyTurnstile("tok", "1.2.3.4", ok({ success: true })))
  check("turnstile: Cloudflare says no -> rejected", !(await verifyTurnstile("tok", null, ok({ success: false }))))
  const down = (async () => { throw new Error("offline") }) as unknown as typeof fetch
  check("turnstile: Cloudflare unreachable -> allowed", await verifyTurnstile("tok", null, down))
  const login = read("app/(auth)/login/actions.ts")
  check("turnstile: login verifies before the password", login.indexOf("verifyTurnstile(") > 0 && login.indexOf("verifyTurnstile(") < login.indexOf("signInWithPassword"))
  const sr = read("app/api/support-request/route.ts")
  check("turnstile: support request verifies before saving", sr.indexOf("verifyTurnstile(") > 0 && sr.indexOf("verifyTurnstile(") < sr.indexOf(".insert("))
  check("turnstile: widget on both forms", read("app/(auth)/login/login-form.tsx").includes("<TurnstileWidget") && read("app/(auth)/login/contact-support.tsx").includes("<TurnstileWidget"))

  // ── Secrets never NEXT_PUBLIC ──────────────────────────────────────────────
  const pub = new Set(code.flatMap((f) => read(f).match(/NEXT_PUBLIC_[A-Z_]+/g) ?? []))
  const allowedPublic = ["NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_TELNYX_FROM_NUMBER", "NEXT_PUBLIC_TURNSTILE_SITE_KEY"]
  const extra = [...pub].filter((v) => !allowedPublic.includes(v))
  check("env: only non-secret NEXT_PUBLIC_ vars", extra.length === 0, extra.join(", "))

  // ── Headers ────────────────────────────────────────────────────────────────
  const cfg = read("next.config.ts")
  for (const h of ["Content-Security-Policy", "X-Frame-Options", "X-Content-Type-Options", "Referrer-Policy", "Permissions-Policy", "Strict-Transport-Security"]) {
    check(`headers: ${h}`, cfg.includes(`"${h}"`))
  }
  check("headers: DENY / nosniff / strict-origin-when-cross-origin", cfg.includes('"DENY"') && cfg.includes('"nosniff"') && cfg.includes('"strict-origin-when-cross-origin"'))
  check("headers: microphone only on self", cfg.includes("microphone=(self)"))
  check("headers: CSP allows Telnyx WebRTC, Deepgram and Turnstile", ["wss://rtc.telnyx.com", "wss://api.deepgram.com", "https://challenges.cloudflare.com"].every((s) => cfg.includes(s)))

  console.log(failed ? `\n${failed} FAILED` : "\nAll security tests passed")
  process.exit(failed ? 1 : 0)
}
main()
