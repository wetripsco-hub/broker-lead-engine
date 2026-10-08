import { createHmac, timingSafeEqual } from "crypto"
import type {
  NormalizedVoiceEvent,
  StartCallInput,
  StartCallResult,
  VoiceAgentProvider,
} from "./provider"

const API = "https://api.retellai.com"
const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000

// Conservative backstop: even if the analysis step doesn't flag it, an
// explicit "stop calling me" in the call is treated as do-not-call.
const STOP_PHRASES = /\b(stop calling|don'?t call( me)?( again)?|do not call|remove me|take me off)\b/i

function apiKey(): string {
  const k = process.env.RETELL_API_KEY
  if (!k) throw new Error("RETELL_API_KEY not set")
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

// What Retell needs to know about the caller number, looked up from the
// account (cached): its exact stored spelling, and for Telnyx trunks the SIP
// username that must go out as a header.
//
// 1) Retell finds the number by the exact string it stored when it was
//    imported, and that can lack the "+" ("12142865022"). Sending
//    "+12142865022" fails with 404 "not found", so use Retell's own spelling.
// 2) Retell's Telnyx setup guide: with credential auth, Telnyx requires
//    `X-Telnyx-Username: <username>` on every outbound call; without it the
//    call is rejected and Retell reports telephony_provider_permission_denied.
const FROM_CACHE_MS = 10 * 60_000
interface FromInfo {
  number: string
  telnyxUsername: string | null
}
const fromCache = new Map<string, { info: FromInfo; at: number }>()

async function resolveFrom(from: string): Promise<FromInfo> {
  const digits = from.replace(/\D/g, "")
  const cached = fromCache.get(digits)
  if (cached && Date.now() - cached.at < FROM_CACHE_MS) return cached.info
  const envUser = process.env.TELNYX_SIP_USERNAME || null
  try {
    const res = await fetch(`${API}/list-phone-numbers`, { headers: { Authorization: `Bearer ${apiKey()}` } })
    if (res.ok) {
      const list = (await res.json()) as Array<{
        phone_number?: string
        sip_outbound_trunk_config?: { termination_uri?: string; auth_username?: string }
      }>
      const hit = list.find((n) => typeof n.phone_number === "string" && n.phone_number.replace(/\D/g, "") === digits)
      if (hit?.phone_number) {
        const trunk = hit.sip_outbound_trunk_config
        const isTelnyx = /telnyx/i.test(trunk?.termination_uri ?? "")
        const info: FromInfo = {
          number: hit.phone_number,
          telnyxUsername: envUser ?? (isTelnyx ? trunk?.auth_username ?? null : null),
        }
        fromCache.set(digits, { info, at: Date.now() })
        return info
      }
    }
  } catch {
    /* fall through to the number as configured */
  }
  return { number: from, telnyxUsername: envUser }
}

export const retellProvider: VoiceAgentProvider = {
  id: "retell",

  // Retell docs: with a number imported over custom telephony (Telnyx SIP
  // trunk), outbound goes through create-phone-call — Retell dials the trunk's
  // termination URI itself. register-phone-call + dialing a SIP URI is only for
  // setups without elastic SIP trunking.
  async startCall(input: StartCallInput): Promise<StartCallResult> {
    const agentId = process.env.RETELL_AGENT_ID
    const caller = await resolveFrom(input.from)
    const res = await fetch(`${API}/v2/create-phone-call`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from_number: caller.number,
        ...(caller.telnyxUsername ? { custom_sip_headers: { "X-Telnyx-Username": caller.telnyxUsername } } : {}),
        to_number: input.to,
        ...(agentId ? { override_agent_id: agentId } : {}),
        retell_llm_dynamic_variables: input.variables,
        metadata: input.metadata,
        ...(input.idempotencyKey ? { idempotency_key: input.idempotencyKey } : {}),
      }),
    })
    if (!res.ok) {
      // Never include request headers (the key) in the error.
      const detail = await res.text().catch(() => "")
      throw new Error(`Retell create-phone-call failed (${res.status}) ${detail.slice(0, 300)}`)
    }
    const data = (await res.json()) as { call_id?: string }
    if (!data.call_id) throw new Error("Retell returned no call_id")
    return { providerCallId: data.call_id }
  },

  // X-Retell-Signature: "v=<ms timestamp>,d=<hex HMAC-SHA256(rawBody + timestamp, apiKey)>"
  verifyWebhook(rawBody: string, headers: Headers): boolean {
    const key = process.env.RETELL_API_KEY
    const header = headers.get("x-retell-signature")
    if (!key || !header) return false
    const m = header.match(/^v=(\d+),d=([0-9a-fA-F]+)$/)
    if (!m) return false
    const [, timestamp, digest] = m
    if (Math.abs(Date.now() - Number(timestamp)) > SIGNATURE_MAX_AGE_MS) return false
    const expected = createHmac("sha256", key).update(rawBody + timestamp).digest("hex")
    const a = Buffer.from(expected, "hex")
    const b = Buffer.from(digest, "hex")
    return a.length === b.length && timingSafeEqual(a, b)
  },

  normalizeEvent(payload: unknown): NormalizedVoiceEvent | null {
    const p = payload as { event?: string; call?: Record<string, any> } | null
    const call = p?.call
    if (!p?.event || !call?.call_id) return null

    const type =
      p.event === "call_started" ? "started" : p.event === "call_ended" ? "ended" : p.event === "call_analyzed" ? "analyzed" : null
    if (!type) return null

    const metadata: Record<string, string> = {}
    for (const [k, v] of Object.entries((call.metadata ?? {}) as Record<string, unknown>)) {
      if (typeof v === "string") metadata[k] = v
    }

    const ev: NormalizedVoiceEvent = {
      type,
      providerCallId: String(call.call_id),
      metadata,
      toNumber: str(call.to_number),
    }

    if (type === "ended") {
      ev.durationSeconds =
        typeof call.duration_ms === "number"
          ? Math.round(call.duration_ms / 1000)
          : typeof call.start_timestamp === "number" && typeof call.end_timestamp === "number"
            ? Math.round((call.end_timestamp - call.start_timestamp) / 1000)
            : undefined
      ev.transcript = str(call.transcript)
      ev.recordingUrl = str(call.recording_url)
      ev.disconnectionReason = str(call.disconnection_reason)
      // Retell reports combined_cost in cents.
      const cents = call.call_cost?.combined_cost
      ev.costUsd = typeof cents === "number" ? Math.round(cents) / 100 : null
    }

    if (type === "analyzed") {
      const a = (call.call_analysis ?? {}) as Record<string, any>
      const custom = (a.custom_analysis_data ?? {}) as Record<string, unknown>
      ev.summary = str(a.call_summary) ?? str(custom.summary)
      ev.sentiment = str(a.user_sentiment)
      ev.interested = asBool(custom.interested)
      ev.usesSoftware = str(custom.uses_software)
      ev.callbackTime = str(custom.callback_time)
      ev.extracted = custom
      ev.transcript = str(call.transcript)
      ev.recordingUrl = str(call.recording_url)
      const flagged = asBool(custom.do_not_call) === true
      const said = STOP_PHRASES.test(`${ev.summary ?? ""}\n${ev.transcript ?? ""}`)
      ev.doNotCall = flagged || said
    }
    return ev
  },
}
