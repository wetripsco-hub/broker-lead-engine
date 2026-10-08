import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

// Mints a short-lived Deepgram access token (POST /v1/auth/grant) so the
// browser never sees the real API key. Only signed-in agents/admins.
// The token only has to be valid while the WebSocket handshake happens.
export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data: agent } = await (supabase.from("agents") as any)
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle()
  if (!agent) return NextResponse.json({ error: "No agent record for this user" }, { status: 403 })

  const key = process.env.DEEPGRAM_API_KEY
  if (!key) return NextResponse.json({ error: "Transcription not configured" }, { status: 503 })

  try {
    const res = await fetch("https://api.deepgram.com/v1/auth/grant", {
      method: "POST",
      headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl_seconds: 60 }),
      cache: "no-store",
    })
    // 401/403 = the key itself can't mint temporary tokens (it needs the
    // Member role or higher). That's a setup problem, not a blip: 503 tells
    // the client not to keep retrying.
    if (res.status === 401 || res.status === 403) {
      return NextResponse.json(
        { error: "The Deepgram API key can't create temporary tokens (use a key with Member or Admin role)" },
        { status: 503 },
      )
    }
    if (!res.ok) return NextResponse.json({ error: "Token request failed" }, { status: 502 })
    const { access_token, expires_in } = (await res.json()) as { access_token: string; expires_in: number }
    return NextResponse.json({ token: access_token, expiresIn: expires_in })
  } catch {
    return NextResponse.json({ error: "Token request failed" }, { status: 502 })
  }
}
