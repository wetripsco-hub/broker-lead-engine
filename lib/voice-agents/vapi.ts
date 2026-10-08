import { createHash, timingSafeEqual } from "crypto"
import { mentionsStopRequest } from "./dnc"
import type {
  NormalizedVoiceEvent,
  StartCallInput,
  StartCallResult,
  VoiceAgentProvider,
} from "./provider"

// Vapi adapter. Field names come from the official @vapi-ai/server-sdk v2.0.1
// types (Call, CreateOutboundCallDto, ServerMessageEndOfCallReport, Artifact,
// Analysis, Server) and docs.vapi.ai:
//   start:   POST https://api.vapi.ai/call, Bearer <private key>
//            { assistantId, phoneNumberId, customer: { number }, assistantOverrides: { variableValues, metadata }, name }
//   webhook: POST <assistant.server.url>, { message: { type: "end-of-call-report" | "status-update", ... } }
//            end-of-call-report: endedReason, cost (USD), startedAt, endedAt, artifact { transcript, recordingUrl },
//            analysis { summary, structuredData }, call { id, name, assistantOverrides.metadata, customer }
//   auth:    the assistant's `server.headers` carries our secret as `x-vapi-secret`
//            (a Vapi Bearer-token credential sends it as `Authorization: Bearer` — both are accepted).

const API = "https://api.vapi.ai"

function apiKey(): string {
  const k = process.env.VAPI_API_KEY
  if (!k) throw new Error("VAPI_API_KEY not set")
  return k
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null)

function asBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v
  if (typeof v === "string") {
    if (/^(true|yes)$/i.test(v.trim())) return true
    if (/^(false|no)$/i.test(v.trim())) return false
  }
  return null
}

// Compare through a hash so the comparison is constant-time whatever the lengths.
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest()
  const hb = createHash("sha256").update(b).digest()
  return timingSafeEqual(ha, hb)
}

function seconds(start: unknown, end: unknown): number | undefined {
  const s = typeof start === "string" ? Date.parse(start) : NaN
  const e = typeof end === "string" ? Date.parse(end) : NaN
  return Number.isFinite(s) && Number.isFinite(e) && e >= s ? Math.round((e - s) / 1000) : undefined
}

export const vapiProvider: VoiceAgentProvider = {
  id: "vapi",
  label: "Vapi",

  configured(): boolean {
    return Boolean(process.env.VAPI_API_KEY && process.env.VAPI_ASSISTANT_ID && process.env.VAPI_PHONE_NUMBER_ID)
  },
  // Vapi dials from the number behind VAPI_PHONE_NUMBER_ID, not a number string.
  fromNumber(): string {
    return ""
  },

  async startCall(input: StartCallInput): Promise<StartCallResult> {
    const assistantId = process.env.VAPI_ASSISTANT_ID
    const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID
    if (!assistantId || !phoneNumberId) throw new Error("VAPI_ASSISTANT_ID / VAPI_PHONE_NUMBER_ID not set")

    const res = await fetch(`${API}/call`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        assistantId,
        phoneNumberId,
        customer: { number: input.to }, // E.164, already normalised by the caller
        assistantOverrides: {
          variableValues: input.variables, // strings only, used as {{name}} in the prompt
          metadata: input.metadata,
        },
        ...(input.label ? { name: input.label } : {}),
      }),
    })
    if (!res.ok) {
      // Never include request headers (the key) in the error.
      const detail = await res.text().catch(() => "")
      throw new Error(`Vapi create call failed (${res.status}) ${detail.slice(0, 300)}`)
    }
    const data = (await res.json()) as { id?: string }
    if (!data.id) throw new Error("Vapi returned no call id")
    return { providerCallId: data.id }
  },

  verifyWebhook(_rawBody: string, headers: Headers): boolean {
    const secret = process.env.VAPI_WEBHOOK_SECRET
    if (!secret) return false // fail closed: no secret configured, nothing is accepted
    const direct = headers.get("x-vapi-secret")
    if (direct && safeEqual(direct, secret)) return true
    const bearer = headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]
    return !!bearer && safeEqual(bearer, secret)
  },

  normalizeEvent(payload: unknown): NormalizedVoiceEvent | NormalizedVoiceEvent[] | null {
    const msg = (payload as { message?: Record<string, any> } | null)?.message
    const call = (msg?.call ?? {}) as Record<string, any>
    const callId = str(call.id)
    if (!msg || !callId) return null

    // lead_id / agent_id / outreach_event_id echoed from assistantOverrides.metadata;
    // `name` ("ble-<event id>") is a fallback for finding our row.
    const metadata: Record<string, string> = {}
    for (const [k, v] of Object.entries((call.assistantOverrides?.metadata ?? {}) as Record<string, unknown>)) {
      if (typeof v === "string") metadata[k] = v
    }
    const name = str(call.name)
    if (!metadata.outreach_event_id && name?.startsWith("ble-")) metadata.outreach_event_id = name.slice(4)

    const toNumber = str(msg.customer?.number) ?? str(call.customer?.number)
    const base = { providerCallId: callId, metadata, toNumber }

    if (msg.type === "status-update") {
      return msg.status === "in-progress" ? { type: "started", ...base } : null
    }

    if (msg.type !== "end-of-call-report") return null

    const artifact = (msg.artifact ?? call.artifact ?? {}) as Record<string, any>
    const analysis = (msg.analysis ?? call.analysis ?? {}) as Record<string, any>
    const data = (analysis.structuredData ?? {}) as Record<string, unknown>
    const transcript = str(artifact.transcript)
    const summary = str(analysis.summary) ?? str(data.summary)

    // One report covers both what Retell splits into "ended" and "analyzed".
    const ended: NormalizedVoiceEvent = {
      type: "ended",
      ...base,
      durationSeconds: seconds(msg.startedAt ?? call.startedAt, msg.endedAt ?? call.endedAt) ?? 0,
      transcript,
      recordingUrl: str(artifact.recordingUrl),
      disconnectionReason: str(msg.endedReason) ?? str(call.endedReason),
      costUsd: typeof msg.cost === "number" ? msg.cost : typeof call.cost === "number" ? call.cost : null,
    }
    const analyzed: NormalizedVoiceEvent = {
      type: "analyzed",
      ...base,
      summary,
      sentiment: str(data.sentiment),
      interested: asBool(data.interested),
      usesSoftware: str(data.uses_software),
      callbackTime: str(data.callback_time),
      extracted: data,
      transcript,
      recordingUrl: str(artifact.recordingUrl),
      doNotCall: asBool(data.do_not_call) === true || mentionsStopRequest(summary, transcript),
    }
    return [ended, analyzed]
  },
}
