import type { VoiceAgentProvider } from "./provider"
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
