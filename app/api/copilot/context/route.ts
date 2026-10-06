import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getCopilotContext } from "@/lib/copilot/server"

// Lead card, opening script and consent flag for the call screen. Talks only
// to our own database — no third-party request is made here.
export async function GET(request: Request) {
  const leadId = new URL(request.url).searchParams.get("leadId")
  if (!leadId) return NextResponse.json({ error: "leadId required" }, { status: 400 })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const ctx = await getCopilotContext(supabase, user.id, leadId)
  if (!ctx) return NextResponse.json({ error: "Lead not found" }, { status: 404 })
  return NextResponse.json(ctx)
}
