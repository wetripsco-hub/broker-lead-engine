// Creates (or updates) the Loadlinkers AI caller as a Vapi assistant.
//
//   npx tsx --env-file=.env.local scripts/create-vapi-assistant.ts --print    # show the payload, send nothing
//   npx tsx --env-file=.env.local scripts/create-vapi-assistant.ts            # create it, prints the assistant id
//   npx tsx --env-file=.env.local scripts/create-vapi-assistant.ts --update   # re-push prompts/ai-caller.md to VAPI_ASSISTANT_ID
//
// Options: --embed-kb          bake a snapshot of the knowledge base into the prompt
//                              (default: the app injects the live knowledge base on every call)
//          --webhook-url=URL   where Vapi sends events (default: <NEXT_PUBLIC_SITE_URL or the Vercel app>/api/webhooks/voice/vapi)
// Env: VAPI_API_KEY, VAPI_WEBHOOK_SECRET; optional VAPI_VOICE_ID (a Cartesia voice id), VAPI_LLM_MODEL.
// NOTE: this script is the source of truth. Edits made in the Vapi dashboard are overwritten by --update,
// and a dashboard save from a stale draft can overwrite what the script pushed. Change things here.
//
// Field names are from the official @vapi-ai/server-sdk v2.0.1 types and docs.vapi.ai.
// Never prints the API key or the webhook secret. Places no call and buys no number.

import { readFileSync } from "fs"
import path from "path"

const API = "https://api.vapi.ai"
const NAME = "Alex (Load Linkers)"
const args = process.argv.slice(2)
const flag = (f: string) => args.includes(f)
const opt = (name: string) => args.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1)

const printOnly = flag("--print")
const updateMode = flag("--update")
const apiKey = process.env.VAPI_API_KEY
const secret = process.env.VAPI_WEBHOOK_SECRET

if (!printOnly && !apiKey) fail("VAPI_API_KEY is not set (run with --env-file=.env.local).")
if (!secret) fail("VAPI_WEBHOOK_SECRET is not set. Make one: openssl rand -base64 32")

function fail(msg: string): never {
  console.error(msg)
  process.exit(1)
}

// Vapi's servers must be able to reach this URL, so a localhost site URL (as in
// .env.local during development) is never used: pass --webhook-url=... to point
// somewhere else on purpose (e.g. an ngrok tunnel).
const configuredSite = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "")
const site = /localhost|127\.0\.0\.1|\[::1\]/i.test(configuredSite) || !configuredSite
  ? "https://broker-lead-engine-phi.vercel.app"
  : configuredSite
const webhookUrl = opt("--webhook-url") ?? `${site}/api/webhooks/voice/vapi`

async function loadPrompt(): Promise<string> {
  let prompt = readFileSync(path.join(process.cwd(), "prompts", "ai-caller.md"), "utf8")
  if (!flag("--embed-kb")) return prompt // {{knowledge_base}} is filled per call by the app

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) fail("--embed-kb needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.")
  const { createClient } = await import("@supabase/supabase-js")
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await db.from("knowledge_base").select("title, content, kind").order("sort_order")
  if (error) fail(`Could not read the knowledge base: ${error.message}`)
  const rows = ((data ?? []) as Array<{ title: string; content: string; kind: string }>).filter((r) => r.content.trim())
  const kb = rows
    .map((r) => (r.kind === "playbook" ? `Objection: "${r.title}"\nApproved answer: ${r.content}` : `## ${r.title}\n${r.content}`))
    .join("\n\n")
  console.log(`Embedding a knowledge-base snapshot: ${rows.length} entries, ~${Math.ceil(kb.length / 4)} tokens. It will NOT update when you edit the KB; re-run with --update.`)
  return prompt.replace("{{knowledge_base}}", kb || "(no knowledge base entries yet)")
}

function assistantPayload(prompt: string) {
  return {
    name: NAME,
    // Disclosure stays in the first sentence, every call: it is a virtual assistant
    // and the call may be recorded. Then the congratulations and the one-line pitch.
    firstMessage:
      "Hi {{contact_name}}, this is Alex from Load Linkers, a virtual assistant, and just so you know, this call may be recorded. First off, congratulations on applying for your MC! We provide software that's a complete package for new brokers like you. Do you have a quick minute?",
    firstMessageMode: "assistant-speaks-first",
    // "Ultra Fast" preset (chosen in the Vapi dashboard): a fast model with minimal
    // reasoning, Cartesia Sonic voice and Deepgram nova-3-general. Kept here so a
    // later --update does not undo it.
    model: {
      provider: "openai",
      model: process.env.VAPI_LLM_MODEL ?? "gpt-5",
      reasoningEffort: "minimal",
      messages: [{ role: "system", content: prompt }],
      tools: [{ type: "endCall" }],
    },
    voice: {
      provider: "cartesia",
      model: "sonic-3.5",
      voiceId: process.env.VAPI_VOICE_ID ?? "a167e0f3-df7e-4d52-a9c3-f949145efdab",
    },
    transcriber: { provider: "deepgram", model: "nova-3-general", language: "en" },
    maxDurationSeconds: 300,
    endCallMessage: "Thanks for your time. Goodbye.",
    // Only the two events the app uses.
    serverMessages: ["status-update", "end-of-call-report"],
    server: { url: webhookUrl, timeoutSeconds: 20, headers: { "x-vapi-secret": secret } },
    artifactPlan: { recordingEnabled: true },
    analysisPlan: {
      summaryPlan: { enabled: true },
      structuredDataPlan: {
        enabled: true,
        schema: {
          type: "object",
          properties: {
            outcome: {
              type: "string",
              enum: ["appointment_booked", "interested", "callback", "not_interested", "unclear"],
              description: "How the call ended. 'appointment_booked' if a day or part of the day (morning/afternoon) for a quick call was agreed. 'not_interested' ONLY if the person clearly declined. 'unclear' if the call was cut short, had audio problems, or no clear answer was given.",
            },
            appointment_time: { type: "string", description: "When the quick call was agreed, as the person said it, for example 'tomorrow morning' or 'Thursday afternoon'. Empty if nothing was agreed." },
            interested: { type: "boolean", description: "True if the person showed interest in Loadlinkers or agreed to a callback." },
            uses_software: { type: "string", description: "What software they currently use for rate confirmations, or 'manual' if by hand. Empty if unknown." },
            callback_time: { type: "string", description: "The day/time the person asked to be called back, as agreed. Empty if none." },
            do_not_call: { type: "boolean", description: "True if the person asked to stop, said not to call again, or asked to be removed." },
            sentiment: { type: "string", enum: ["positive", "neutral", "negative"], description: "The person's overall attitude on the call." },
          },
          required: [],
        },
      },
    },
  }
}

const redact = (v: unknown) =>
  JSON.parse(JSON.stringify(v, (k, val) => (k === "x-vapi-secret" ? "<redacted>" : val)))

async function main() {
  const body = assistantPayload(await loadPrompt())

  if (printOnly) {
    console.log(JSON.stringify(redact(body), null, 2))
    console.log(`\n(no request sent) webhook: ${webhookUrl}`)
    return
  }

  const existingId = process.env.VAPI_ASSISTANT_ID
  if (updateMode && !existingId) fail("--update needs VAPI_ASSISTANT_ID.")
  const res = await fetch(updateMode ? `${API}/assistant/${existingId}` : `${API}/assistant`, {
    method: updateMode ? "PATCH" : "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) fail(`Vapi ${updateMode ? "update" : "create"} assistant failed (${res.status}): ${text.slice(0, 600)}`)
  const id = (JSON.parse(text) as { id?: string }).id
  console.log(`${updateMode ? "Updated" : "Created"} Vapi assistant: ${id}`)
  if (!updateMode) {
    console.log(`\nAdd to Vercel + .env.local:\n  VOICE_PROVIDER=vapi\n  VAPI_ASSISTANT_ID=${id}\n  VAPI_PHONE_NUMBER_ID=<id of your number in Vapi>\n  VAPI_API_KEY=<private key>\n  VAPI_WEBHOOK_SECRET=<the same secret used above>`)
  }
}

main().catch((e) => fail(e instanceof Error ? e.message : "Unexpected error"))
