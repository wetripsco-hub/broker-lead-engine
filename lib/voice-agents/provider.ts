// Provider-neutral contract for AI voice-agent calling. The rest of the app
// only talks to this; Retell today, Vapi (or another) later.

export interface StartCallInput {
  /** E.164 destination. */
  to: string
  /** E.164 caller id, must be a number the provider owns/has imported. */
  from: string
  /** Strings only — providers inject these into the prompt. */
  variables: Record<string, string>
  /** lead_id, agent_id, outreach_event_id — echoed back on every webhook. */
  metadata: Record<string, string>
  /** Lets the provider de-duplicate a retried start. */
  idempotencyKey?: string
  /** Short label stored on the provider's call record (also a webhook fallback for finding our row). */
  label?: string
}

export interface StartCallResult {
  providerCallId: string
}

export type VoiceEventType = "started" | "ended" | "analyzed"

export interface NormalizedVoiceEvent {
  type: VoiceEventType
  providerCallId: string
  /** Echo of StartCallInput.metadata. */
  metadata: Record<string, string>
  toNumber: string | null
  // ended
  durationSeconds?: number
  transcript?: string | null
  recordingUrl?: string | null
  disconnectionReason?: string | null
  costUsd?: number | null
  // analyzed
  summary?: string | null
  sentiment?: string | null
  interested?: boolean | null
  usesSoftware?: string | null
  callbackTime?: string | null
  doNotCall?: boolean
  extracted?: Record<string, unknown> | null
}

export interface VoiceAgentProvider {
  readonly id: string
  /** Name shown in Settings. */
  readonly label: string
  /** All environment settings this provider needs are present. */
  configured(): boolean
  /** Caller-id number to pass as StartCallInput.from ("" when the provider picks it, e.g. Vapi's phoneNumberId). */
  fromNumber(): string
  startCall(input: StartCallInput): Promise<StartCallResult>
  /** Must be given the exact raw body string, never a re-serialised one. */
  verifyWebhook(rawBody: string, headers: Headers): boolean
  /**
   * Returns null for events we don't act on. A provider that reports a whole
   * call in one message (Vapi's end-of-call-report) returns several events.
   */
  normalizeEvent(payload: unknown): NormalizedVoiceEvent | NormalizedVoiceEvent[] | null
}
