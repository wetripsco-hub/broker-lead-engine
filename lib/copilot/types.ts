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
  disposition:
    | "no_answer"
    | "left_voicemail"
    | "answered_interested"
    | "answered_not_interested"
    | "callback"
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
  openingScript: string
}

export const OPENING_SCRIPT =
  "Hey {{contact_name}}, this is {{agent_name}} with Loadlinkers. I sent you a quick note yesterday regarding your new authority for {{company_name}}. Did you already pick a software for issuing rate cons, or are you still doing them manually?"

export const NOT_IN_MANUAL_REPLY = "Good question, let me confirm and get back to you today."

export const RECORDING_REMINDER = "This call may be recorded and transcribed for quality purposes."
