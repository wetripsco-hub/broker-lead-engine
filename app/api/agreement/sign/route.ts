import { randomInt } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { clientIp, hitRateLimit, TOO_MANY, type RateRule } from "@/lib/rate-limit"
import { AGREEMENT_VERSION } from "@/lib/agreement"
import { agreementSha256 } from "@/lib/agreement/hash"

// Public: the agreement page has no login. Everything is saved with the service
// role; the table has no browser policies at all.

const SIGN_LIMIT: RateRule = { bucket: "agreement-sign", max: 5, windowSeconds: 60 * 60 }
const REF_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789" // no 0/O/1/I/L

function newReference(): string {
  let s = "AGR-"
  for (let i = 0; i < 6; i++) s += REF_CHARS[randomInt(REF_CHARS.length)]
  return s
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers)
  if (!(await hitRateLimit(SIGN_LIMIT, ip))) {
    return NextResponse.json({ error: TOO_MANY }, { status: 429, headers: { "Retry-After": "3600" } })
  }

  let body: Record<string, unknown>
  try {
    const parsed = await req.json()
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("bad body")
    body = parsed as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 })
  }

  // Honeypot: a bot filled the hidden field. Answer like a success, save nothing.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return NextResponse.json({ ok: true, reference: newReference(), signedAt: new Date().toISOString(), version: AGREEMENT_VERSION })
  }

  const fullName = typeof body.fullName === "string" ? body.fullName.trim().replace(/\s+/g, " ") : ""
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : ""
  const country = typeof body.country === "string" ? body.country.trim().replace(/\s+/g, " ") : ""

  if (fullName.length < 3 || fullName.length > 120) return NextResponse.json({ error: "Enter your full legal name (3 to 120 characters)." }, { status: 400 })
  if (email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 })
  if (country.length < 2 || country.length > 80) return NextResponse.json({ error: "Enter your country (2 to 80 characters)." }, { status: 400 })
  if (body.agreed !== true) return NextResponse.json({ error: "You must agree to the terms to sign." }, { status: 400 })
  if (body.version !== AGREEMENT_VERSION) {
    return NextResponse.json({ error: "This agreement was updated. Please reload the page and read the latest version." }, { status: 409 })
  }

  const sha = agreementSha256(AGREEMENT_VERSION)
  if (!sha) return NextResponse.json({ error: "Could not sign right now. Please try again." }, { status: 500 })

  const userAgent = (req.headers.get("user-agent") ?? "").slice(0, 400) || null

  try {
    const admin = createAdminClient()
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data, error } = await (admin.from("agent_agreements") as any)
        .insert({
          reference: newReference(),
          full_name: fullName,
          email,
          country,
          agreement_version: AGREEMENT_VERSION,
          agreement_sha256: sha,
          ip: ip === "unknown" ? null : ip,
          user_agent: userAgent,
        })
        .select("reference, signed_at")
        .single()
      if (!error && data) {
        return NextResponse.json({ ok: true, reference: data.reference, signedAt: data.signed_at, version: AGREEMENT_VERSION })
      }
      if (error?.code !== "23505") throw error // only a reference clash is retried
    }
    throw new Error("could not find a free reference")
  } catch (err) {
    console.error("[agreement-sign]", err)
    return NextResponse.json({ error: "Could not sign right now. Please try again." }, { status: 500 })
  }
}
