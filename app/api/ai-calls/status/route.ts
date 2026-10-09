import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

// Small read-only status for one AI call, used by the auto-dial queue to know
// when a call has ended. Read with the signed-in user's own session, so
// row-level security decides who can see which call.
export async function GET(request: Request) {
  const eventId = new URL(request.url).searchParams.get("eventId")
  if (!eventId || !/^[0-9a-f-]{36}$/i.test(eventId)) return NextResponse.json({ error: "eventId required" }, { status: 400 })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 })

  const { data } = await (supabase.from("outreach_events") as any)
    .select("call_status, status, duration_seconds, disposition, sentiment, ai_summary")
    .eq("id", eventId)
    .eq("channel", "ai_call")
    .maybeSingle()
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } })
}
