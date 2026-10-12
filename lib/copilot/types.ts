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
  /** The rest of the pitch, in order, after the person says yes to the opening. */
  pitchSteps: PitchStep[]
}

export interface PitchStep {
  label: string
  text: string
}

// The agent calls in person and introduces themself as Head of Marketing.
export const OPENING_SCRIPT =
  "Hi {{contact_name}}, this is {{agent_name}}, Head of Marketing at Load Linkers. Do you have a quick minute?"

// What to say after they agree. Claims are limited to what is known about Load Linkers
// (software, a complete package for new brokers); anything more goes through the manual.
export const PITCH_STEPS: PitchStep[] = [
  {
    label: "1. Why I'm calling",
    text: "Thanks, I'll be quick. Congratulations on getting your MC for {{company_name}}. I'm reaching out because Load Linkers provides a complete software package for new brokers like you.",
  },
  {
    label: "2. Ask",
    text: "Quick question: are you using any software for your rate confirmations yet, or are you doing them manually?",
  },
  {
    label: "3. If manual / no software",
    text: "Got it, that's very common when you're starting out. That's exactly what we help with. Our team can show you how it works in a quick call.",
  },
  {
    label: "3. If they already have software",
    text: "Nice. Which one are you using? A lot of new brokers like to compare before they commit, so it can be worth a quick look.",
  },
  {
    label: "4. Book the call",
    text: "Would tomorrow morning or afternoon be better for a quick call with our team?",
  },
  {
    label: "5. Close",
    text: "Great. I'll send you a text and an email with the details, and you can also check out Load Linkers dot co. Thanks for your time, {{contact_name}}, have a great day!",
  },
  {
    label: "If they're busy",
    text: "No problem at all. When would be a better time, tomorrow morning or afternoon?",
  },
  {
    label: "If not interested",
    text: "Understood, thank you for your time and congratulations again on the new authority. Have a great day!",
  },
]

export const NOT_IN_MANUAL_REPLY = "Good question, let me confirm and get back to you today."

export const RECORDING_REMINDER = "This call may be recorded and transcribed for quality purposes."
