import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { generateJson, LlmError } from "@/lib/copilot/llm"
import { loadKnowledge } from "@/lib/copilot/kb"
import { checkRateLimit, getCopilotContext } from "@/lib/copilot/server"
import { NOT_IN_MANUAL_REPLY, type Suggestion, type Turn } from "@/lib/copilot/types"

const MAX_TURNS = 10
const MAX_TURN_CHARS = 600

function systemPrompt(knowledge: string, empty: boolean): string {
  return `You are a live sales copilot whispering suggestions to a Loadlinkers sales agent during a phone call with a freight broker. Loadlinkers sells software; the agent's goal is to book a demo/call or get permission to follow up by email.

RULES
- Answer ONLY from the knowledge base below. Never invent features, pricing, discounts, integrations, guarantees or claims.
- Anything the knowledge base does not cover (including any question about price if no price is written there): set "not_in_manual" to true and make the FIRST reply exactly: "${NOT_IN_MANUAL_REPLY}". The other replies may politely steer the conversation but must not state facts that are not in the knowledge base.
- If the broker's message is covered by an entry in the objection playbook, base the replies on its approved answer.
- Never be pushy. If the broker says no or asks to stop, suggest a polite exit and permission to follow up by email.
- Replies are things the agent can SAY OUT LOUD: 1-2 short sentences, natural spoken English, no bullet points, no jargon, no markdown.
- "intent" is a 1-3 word label for what the broker just meant (e.g. "objection: has software", "asks price", "interested", "busy", "not interested").
- "summary" is one short sentence describing what the broker said.
- "next_question" is one short question the agent can ask to move toward a demo/email permission.
${empty ? "- The knowledge base is currently EMPTY: treat every factual question as not covered.\n" : ""}
Respond with ONLY a JSON object, no prose:
{"intent": string, "summary": string, "replies": [string, string, string], "next_question": string, "not_in_manual": boolean}

KNOWLEDGE BASE
${empty ? "(empty)" : knowledge}`
}

function clean(s: unknown, max = 400): string {
  return typeof s === "string" ? s.trim().slice(0, max) : ""
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: { leadId?: string; callId?: string; turns?: Turn[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const turns = (Array.isArray(body.turns) ? body.turns : [])
    .filter((t) => (t?.speaker === "broker" || t?.speaker === "agent") && clean(t.text))
    .slice(-MAX_TURNS)
    .map((t) => ({ speaker: t.speaker, text: clean(t.text, MAX_TURN_CHARS) }))
  if (!body.leadId || turns.length === 0 || turns[turns.length - 1].speaker !== "broker") {
    return NextResponse.json({ error: "Nothing to suggest on" }, { status: 400 })
  }

  const ctx = await getCopilotContext(supabase, user.id, body.leadId)
  if (!ctx) return NextResponse.json({ error: "Lead not found" }, { status: 404 })

  // Same 429 shape as a provider rate limit, so the panel treats both as "busy".
  if (!checkRateLimit(`${user.id}:${body.callId ?? body.leadId}`)) {
    return NextResponse.json({ busy: true }, { status: 429 })
  }

  try {
    const kb = await loadKnowledge(supabase, turns.filter((t) => t.speaker === "broker").map((t) => t.text).join(" "))
    const user_ = [
      `LEAD: ${ctx.lead.companyName}${ctx.lead.contactName ? `, contact ${ctx.lead.contactName}` : ""}${
        ctx.lead.state ? `, ${ctx.lead.state}` : ""
      }${ctx.lead.mcStatus ? `, MC status: ${ctx.lead.mcStatus}` : ""}`,
      `AGENT NAME: ${ctx.agentName}`,
      "",
      "CONVERSATION SO FAR (oldest first):",
      ...turns.map((t) => `${t.speaker === "broker" ? "BROKER" : "AGENT"}: ${t.text}`),
      "",
      "Suggest what the agent should say next, in response to the broker's last message.",
    ].join("\n")

    const raw = await generateJson<Partial<Suggestion>>({
      system: systemPrompt(kb.text, kb.empty),
      user: user_,
    })

    const replies = (Array.isArray(raw.replies) ? raw.replies : []).map((r) => clean(r)).filter(Boolean).slice(0, 3)
    if (replies.length === 0) throw new LlmError("Malformed suggestion", 502)
    const notInManual = raw.not_in_manual === true
    if (notInManual && replies[0] !== NOT_IN_MANUAL_REPLY) replies.unshift(NOT_IN_MANUAL_REPLY)

    const suggestion: Suggestion = {
      intent: clean(raw.intent, 60),
      summary: clean(raw.summary, 200),
      replies: replies.slice(0, 3),
      next_question: clean(raw.next_question, 200),
      not_in_manual: notInManual,
    }
    return NextResponse.json(suggestion)
  } catch (err) {
    if (err instanceof LlmError && err.rateLimited) {
      return NextResponse.json({ busy: true }, { status: 429 })
    }
    return NextResponse.json({ error: "Copilot unavailable" }, { status: 502 })
  }
}
