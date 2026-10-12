// Ready-to-send SMS texts for the lead page. Tapping one fills the SMS box (the agent can
// edit it, then presses Send). Kept short: two SMS segments at most.
import { spokenContactName } from "@/lib/voice-agents/names"

export interface SmsTemplate {
  id: string
  label: string
  text: string
}

export const LOADLINKERS_URL = "https://loadlinkers.co"

export function buildSmsTemplates(opts: { contactName: string | null; agentName: string | null }): SmsTemplate[] {
  const first = spokenContactName(opts.contactName)
  const agent = opts.agentName && !opts.agentName.includes("@") ? opts.agentName.trim() : ""
  const intro = agent ? `Hi ${first}, it's ${agent} from Load Linkers.` : `Hi ${first}, it's the Load Linkers team.`
  return [
    {
      id: "trial-link",
      label: "Trial link (after they OK)",
      text: `${intro} As promised, here are the details: you can check out our software yourself, anytime, at ${LOADLINKERS_URL} with a 7-day trial. Reply here with any questions. Reply STOP to opt out.`,
    },
    {
      id: "callback",
      label: "Quick call tomorrow",
      text: `${intro} Thanks for your time today. I'll have our team call you tomorrow for a quick chat, and you can look around anytime at ${LOADLINKERS_URL}. Reply STOP to opt out.`,
    },
  ]
}
