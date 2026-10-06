import type { VoiceAgentProvider } from "./provider"

// Placeholder so the registry has a second slot. Not implemented.
export const vapiProvider: VoiceAgentProvider = {
  id: "vapi",
  async startCall() {
    throw new Error("Vapi is not supported yet")
  },
  verifyWebhook() {
    return false
  },
  normalizeEvent() {
    return null
  },
}
