// Creates the Loadlinkers AI caller on Retell and binds it as the OUTBOUND
// agent of the existing number. Run:
//
//   npx tsx --env-file=.env.local scripts/setup-retell-agent.ts
//   npx tsx --env-file=.env.local scripts/setup-retell-agent.ts --update-prompt   (re-push prompts/ai-caller.md)
//
// Reads RETELL_API_KEY from the environment and never prints it. Does NOT
// place any call and does NOT buy a number.

import { readFileSync } from "fs"
import path from "path"

const API = "https://api.retellai.com"
const WEBHOOK_URL = "https://broker-lead-engine-phi.vercel.app/api/webhooks/voice/retell"
const AGENT_NAME = "Loadlinkers AI caller"

const key = process.env.RETELL_API_KEY
if (!key) {
  console.error("RETELL_API_KEY is not set (run with --env-file=.env.local).")
  process.exit(1)
}
const fromNumber = process.env.RETELL_FROM_NUMBER ?? "+12142865022"
const transferNumber = process.env.AI_CALL_TRANSFER_NUMBER
const updatePromptOnly = process.argv.includes("--update-prompt")
// Re-run only the number binding for an agent that already exists.
const bindIdx = process.argv.indexOf("--bind")
const bindOnlyAgentId = bindIdx >= 0 ? process.argv[bindIdx + 1] : null

async function retell<T = any>(method: string, route: string, body?: unknown): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(`${API}${route}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let data: any = text
  try {
    data = JSON.parse(text)
  } catch {}
  return { ok: res.ok, status: res.status, data }
}

function describeError(r: { status: number; data: any }): string {
  const msg = typeof r.data === "string" ? r.data : (r.data?.message ?? JSON.stringify(r.data))
  return `HTTP ${r.status}: ${String(msg).slice(0, 300)}`
}

const prompt = readFileSync(path.join(process.cwd(), "prompts", "ai-caller.md"), "utf8")

const tools: any[] = [
  {
    type: "end_call",
    name: "end_call",
    description: "End the call when the person asks you to stop, is not interested, asks not to be called again, or the conversation is finished.",
  },
]
if (transferNumber) {
  tools.push({
    type: "transfer_call",
    name: "transfer_to_human",
    description: "Transfer the call to a human on the Loadlinkers team when the person asks to speak to a person.",
    transfer_destination: { type: "predefined", number: transferNumber },
    transfer_option: { type: "cold_transfer" },
  })
}

async function pickVoice(): Promise<string> {
  const wanted = process.env.RETELL_VOICE_ID
  const r = await retell<any[]>("GET", "/list-voices")
  const voices = r.ok && Array.isArray(r.data) ? r.data : []
  if (wanted) {
    if (voices.length && !voices.some((v) => v.voice_id === wanted)) throw new Error(`RETELL_VOICE_ID "${wanted}" not found in list-voices`)
    return wanted
  }
  const english = voices.filter((v) => /english|american|en-us/i.test(`${v.accent ?? ""} ${v.language ?? ""} ${v.voice_name ?? ""}`))
  const pool = english.length ? english : voices
  if (!pool.length) throw new Error("Could not list voices; set RETELL_VOICE_ID")
  return pool[0].voice_id
}

// Retell can store an imported number without the leading "+", so find it by
// digits instead of trusting the E.164 string in the URL.
async function resolveNumber(): Promise<{ id: string; record: any } | null> {
  const r = await retell<any[]>("GET", "/list-phone-numbers")
  if (!r.ok || !Array.isArray(r.data)) return null
  const want = fromNumber.replace(/\D/g, "")
  const rec = r.data.find((n) => String(n.phone_number).replace(/\D/g, "") === want)
  return rec ? { id: String(rec.phone_number), record: rec } : null
}

async function main() {
  if (updatePromptOnly) {
    const agentId = process.env.RETELL_AGENT_ID
    if (!agentId) throw new Error("RETELL_AGENT_ID is required for --update-prompt")
    const a = await retell("GET", `/get-agent/${agentId}`)
    if (!a.ok) throw new Error(`get-agent failed. ${describeError(a)}`)
    const llmId = a.data?.response_engine?.llm_id
    if (!llmId) throw new Error("Agent has no retell-llm response engine")
    const u = await retell("PATCH", `/update-retell-llm/${llmId}`, { general_prompt: prompt })
    if (!u.ok) throw new Error(`update-retell-llm failed. ${describeError(u)}`)
    console.log(`Prompt updated on LLM ${llmId} (agent ${agentId}). Publish/redeploy per Retell if you use versions.`)
    return
  }

  if (bindOnlyAgentId) {
    await bindOutbound(bindOnlyAgentId)
    return
  }

  // 1) Response engine (the prompt + tools)
  const llm = await retell("POST", "/create-retell-llm", {
    general_prompt: prompt,
    start_speaker: "agent",
    general_tools: tools,
    default_dynamic_variables: {
      contact_name: "there",
      company_name: "your company",
      state: "",
      mc_status: "",
      agent_name: "our team",
      knowledge_base: "(no knowledge base entries yet)",
    },
  })
  if (!llm.ok) throw new Error(`create-retell-llm failed. ${describeError(llm)}`)
  const llmId: string = llm.data.llm_id
  console.log(`Created Retell LLM: ${llmId}`)

  // 2) Agent
  const voiceId = await pickVoice()
  const agent = await retell("POST", "/create-agent", {
    agent_name: AGENT_NAME,
    response_engine: { type: "retell-llm", llm_id: llmId },
    voice_id: voiceId,
    language: "en-US",
    webhook_url: WEBHOOK_URL,
    webhook_events: ["call_started", "call_ended", "call_analyzed"],
    max_call_duration_ms: 5 * 60 * 1000,
    voicemail_option: { action: { type: "hangup" } },
    post_call_analysis_data: [
      { type: "boolean", name: "interested", description: "True if the person showed interest in Loadlinkers or agreed to a callback." },
      { type: "string", name: "uses_software", description: "What software, if any, they currently use for rate confirmations, or 'manual' if they do it by hand. Empty if unknown." },
      { type: "string", name: "callback_time", description: "The day/time the person asked to be called back, exactly as agreed. Empty if none." },
      { type: "boolean", name: "do_not_call", description: "True if the person asked to stop, said not interested in a way that means don't call again, or asked to be removed from calls." },
      { type: "string", name: "summary", description: "One or two sentences on what happened on the call." },
    ],
  })
  if (!agent.ok) throw new Error(`create-agent failed. ${describeError(agent)}`)
  const agentId: string = agent.data.agent_id
  console.log(`Created Retell agent: ${agentId}  (voice ${voiceId})`)

  await bindOutbound(agentId)
}

async function bindOutbound(agentId: string) {
  // Bind as OUTBOUND agent only. Inbound agents are left untouched — this
  // number also carries the sales team's own calls and SMS.
  const num = await resolveNumber()
  if (!num) {
    console.log(`
Could not find ${fromNumber} in this Retell account.`)
    manualBind(agentId)
    return
  }
  const existing: any[] = num.record.outbound_agents ?? (num.record.outbound_agent_id ? [{ agent_id: num.record.outbound_agent_id }] : [])
  if (existing.length > 0 && !existing.some((a) => a.agent_id === agentId)) {
    console.log(`
${fromNumber} already has an outbound agent bound (${existing.map((a) => a.agent_id).join(", ")}). Not overwriting it.`)
    manualBind(agentId)
    return
  }
  const bind = await retell("PATCH", `/update-phone-number/${num.id}`, {
    outbound_agents: [{ agent_id: agentId, weight: 1 }],
  })
  if (!bind.ok) {
    console.log(`
Binding failed. ${describeError(bind)}`)
    manualBind(agentId)
    return
  }
  const after = await resolveNumber()
  const out = after?.record.outbound_agents ?? []
  const inbound = after?.record.inbound_agents ?? (after?.record.inbound_agent_id ? [after.record.inbound_agent_id] : [])
  const before = num.record.inbound_agents ?? (num.record.inbound_agent_id ? [num.record.inbound_agent_id] : [])
  console.log(`Outbound agent on ${fromNumber}: ${JSON.stringify(out.map((a: any) => a.agent_id))}`)
  console.log(`Inbound agents: ${inbound.length} before, ${before.length === inbound.length ? "unchanged" : "CHANGED - check the dashboard"} after.`)

  console.log(`
Add these to Vercel + .env.local:
  RETELL_AGENT_ID=${agentId}
  RETELL_FROM_NUMBER=${fromNumber}
  VOICE_PROVIDER=retell`)
}

function manualBind(agentId: string) {
  console.log(
    `\nDo this by hand in the Retell dashboard: Phone Numbers → ${fromNumber} → set the OUTBOUND agent to "${AGENT_NAME}" (${agentId}). Leave INBOUND as None.\n` +
      `Then set RETELL_AGENT_ID=${agentId} in Vercel and .env.local.`,
  )
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Unexpected error")
  process.exit(1)
})
