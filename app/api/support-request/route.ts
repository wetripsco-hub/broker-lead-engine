import { createHash } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { SUPPORT_SENT_MESSAGE, isRateLimited, validateSupportRequest } from "@/lib/support-request"

// Login screen "Contact Support". No session here, so everything goes through
// the service role. The answer never says whether the login ID exists.

// The IP is stored only as a hash — enough to rate limit, nothing more.
function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex")
}

export async function POST(req: NextRequest) {
  let body: { loginId?: unknown; message?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 })
  }
  const parsed = validateSupportRequest(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown"
  const ipHash = hashIp(ip)

  try {
    const admin = createAdminClient()
    const since = new Date(Date.now() - 60 * 60_000).toISOString()
    const { count } = await (admin.from("support_requests") as any)
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .gte("created_at", since)
    if (isRateLimited(count ?? 0)) {
      return NextResponse.json({ error: "Too many requests. Please try again in an hour." }, { status: 429 })
    }

    const { data: agent } = await (admin.from("agents") as any)
      .select("id")
      .ilike("email", parsed.value.loginId.replace(/[\\%_]/g, "\\$&")) // case-insensitive, no wildcards
      .limit(1)
      .maybeSingle()

    const { error } = await (admin.from("support_requests") as any).insert({
      login_id: parsed.value.loginId,
      agent_id: (agent as { id: string } | null)?.id ?? null,
      message: parsed.value.message,
      ip_hash: ipHash,
    })
    if (error) throw error
  } catch (err) {
    console.error("[support-request]", err)
    return NextResponse.json({ error: "Could not send your request. Please try again." }, { status: 500 })
  }

  return NextResponse.json({ message: SUPPORT_SENT_MESSAGE })
}
