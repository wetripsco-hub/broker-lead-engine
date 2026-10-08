import type { NormalizedVoiceEvent, VoiceAgentProvider } from "./provider"
import { retellProvider } from "./retell"
import { vapiProvider } from "./vapi"

const PROVIDERS: Record<string, VoiceAgentProvider> = {
  retell: retellProvider,
  vapi: vapiProvider,
}

/** Provider selected by VOICE_PROVIDER (default: retell). */
export function getVoiceProvider(): VoiceAgentProvider {
  return PROVIDERS[process.env.VOICE_PROVIDER ?? "retell"] ?? retellProvider
}

/** Provider named in a webhook URL. */
export function getVoiceProviderById(id: string): VoiceAgentProvider | null {
  return PROVIDERS[id] ?? null
}

export type { VoiceAgentProvider, NormalizedVoiceEvent } from "./provider"

export type ParsedWebhook =
  | { ok: false; status: 400 | 401; error: string }
  | { ok: true; events: NormalizedVoiceEvent[] }

/** Verify the signature/secret on the RAW body, then turn it into zero or more events. */
export function parseWebhook(provider: VoiceAgentProvider, rawBody: string, headers: Headers): ParsedWebhook {
  if (!provider.verifyWebhook(rawBody, headers)) return { ok: false, status: 401, error: "Invalid signature" }
  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return { ok: false, status: 400, error: "Invalid JSON" }
  }
  const out = provider.normalizeEvent(payload)
  return { ok: true, events: out == null ? [] : Array.isArray(out) ? out : [out] }
}
