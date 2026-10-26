export type Speaker = "broker" | "agent"

export interface Turn {
  speaker: Speaker
  text: string
}

export interface Suggestion {
  intent: string
  summary: string
  replies: string[]
  next_question: string
  not_in_manual: boolean
}

export interface CallWrapUp {
  summary: string
  // Only outcomes with no side effects. Trial/Marketplace link sent (records SMS permission),
  // Do not call and Demo booked are always chosen by the caller.
  disposition:
    | "no_answer"
    | "left_voicemail"
    | "callback"
    | "not_interested"
    | "email_requested"
    | "wrong_number"
  follow_up_date: string | null
}

export interface CopilotContext {
  agentName: string
  announceRecording: boolean
  llmProvider: "gemini" | "anthropic"
  lead: {
    companyName: string
    contactName: string | null
    state: string | null
    mcNumber: string | null
    mcStatus: string | null
  }
}

export const NOT_IN_MANUAL_REPLY = "Good question, let me confirm and get back to you today."

export const RECORDING_REMINDER = "This call may be recorded and transcribed for quality purposes."
