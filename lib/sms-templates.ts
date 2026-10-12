// Ready-to-send SMS texts for the lead page. Tapping one fills the SMS box (the agent can
// edit it, then presses Send). Kept short: two SMS segments at most.
import { spokenContactName } from "@/lib/voice-agents/names"

export interface SmsTemplate {
  id: string
  label: string
  text: string
}

export const LOADLINKERS_URL = "https://loadlinkers.co"

// One SMS segment holds 160 characters of plain text (GSM-7). A single curly quote, emoji or
// other special character switches the whole message to 70 characters per segment, so these
// texts stay plain ASCII and are checked to fit 160 (see scripts/_sms-template-tests.ts).
export const SMS_ONE_SEGMENT = 160

// Longest wording that still fits one segment with this contact and agent name.
function fit(options: string[]): string {
  return options.find((t) => t.length <= SMS_ONE_SEGMENT) ?? options[options.length - 1]
}

export function buildSmsTemplates(opts: { contactName: string | null; agentName: string | null }): SmsTemplate[] {
  const first = spokenContactName(opts.contactName)
  const agent = opts.agentName && !opts.agentName.includes("@") ? opts.agentName.trim() : ""
  const from = agent ? `${agent} from Load Linkers` : "Load Linkers"
  return [
    {
      id: "trial-link",
      label: "Trial link (after they OK)",
      text: fit([
        `Hi ${first}, ${from}. Check us out anytime at ${LOADLINKERS_URL} (self checkout, 7-day trial). Reply STOP to opt out.`,
        `Hi ${first}, ${from}. Self checkout, 7-day trial: ${LOADLINKERS_URL} Reply STOP to opt out.`,
        `Hi ${first}, Load Linkers here. 7-day trial: ${LOADLINKERS_URL} Reply STOP to opt out.`,
      ]),
    },
    {
      id: "callback",
      label: "Quick call tomorrow",
      text: fit([
        `Hi ${first}, ${from}. Thanks for your time! Our team will call you tomorrow. Details: ${LOADLINKERS_URL} Reply STOP to opt out.`,
        `Hi ${first}, Load Linkers here. Our team will call you tomorrow. ${LOADLINKERS_URL} Reply STOP to opt out.`,
      ]),
    },
  ]
}
