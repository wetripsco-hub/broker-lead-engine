import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { generateJson, LlmError } from "@/lib/copilot/llm"
import { getCopilotContext } from "@/lib/copilot/server"
import type { CallWrapUp } from "@/lib/copilot/types"

const DISPOSITIONS: CallWrapUp["disposition"][] = [
  "no_answer",
  "left_voicemail",
  "answered_interested",
  "answered_not_interested",
  "callback",
  "wrong_number",
]

const SYSTEM = `You summarise a finished sales call between a Loadlinkers sales agent and a freight broker.
Respond with ONLY a JSON object:
{"summary": string, "disposition": one of ${JSON.stringify(DISPOSITIONS)}, "follow_up_date": "YYYY-MM-DD" or null}
- summary: 1-3 short sentences: what the broker said, objections, what was agreed.
- disposition: pick the single best fit.
- follow_up_date: only if a specific callback/follow-up time was agreed or clearly implied; compute it from TODAY. Otherwise null.
Use only what is in the transcript. Do not invent anything.`

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: { leadId?: string; transcript?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const transcript = typeof body.transcript === "string" ? body.transcript.trim().slice(0, 30_000) : ""
  if (!body.leadId || !transcript) return NextResponse.json({ error: "Nothing to summarise" }, { status: 400 })

  const ctx = await getCopilotContext(supabase, user.id, body.leadId)
  if (!ctx) return NextResponse.json({ error: "Lead not found" }, { status: 404 })

  try {
    const raw = await generateJson<Partial<CallWrapUp>>({
      system: SYSTEM,
      user: `TODAY: ${new Date().toISOString().slice(0, 10)}\nLEAD: ${ctx.lead.companyName}\n\nTRANSCRIPT:\n${transcript}`,
      maxTokens: 500,
    })
    const wrap: CallWrapUp = {
      summary: typeof raw.summary === "string" ? raw.summary.trim().slice(0, 600) : "",
      disposition: DISPOSITIONS.includes(raw.disposition as CallWrapUp["disposition"])
        ? (raw.disposition as CallWrapUp["disposition"])
        : "answered_not_interested",
      follow_up_date:
        typeof raw.follow_up_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.follow_up_date)
          ? raw.follow_up_date
          : null,
    }
    return NextResponse.json(wrap)
  } catch (err) {
    const status = err instanceof LlmError && err.rateLimited ? 429 : 502
    return NextResponse.json({ error: "Summary unavailable" }, { status })
  }
}
