// Who may send an SMS to a lead. Pure rules (no I/O) so they can be tested; the server actions
// gather the facts and call this.
//
//  - Do-not-call blocks everyone, admins included (a person who asked to stop must not be texted).
//  - Admins may text any lead, with or without recorded permission.
//  - An agent texts only when the admin turned SMS on for them (Agents page, "SMS" tick).
//  - Agents may text a lead only after permission was recorded on a call ("Trial link sent" /
//    "Marketplace link sent"), or to reply to someone who texted us first.

export interface SmsFacts {
  isAdmin: boolean
  /** The lead is flagged do-not-call, or its number is on the do-not-call list. */
  doNotCall: boolean
  /** leads.sms_consent_at is set. */
  hasSmsConsent: boolean
  /** This person has texted us before (an inbound SMS from the number exists). */
  hasInbound: boolean
  /** Agents only: the admin turned SMS on for this agent. Ignored for admins. */
  agentSmsEnabled: boolean
}

export type SmsDecision = { allowed: true } | { allowed: false; reason: string }

export const SMS_BLOCK_DNC = "This lead is marked do-not-call. Texts are blocked."
export const SMS_BLOCK_NO_CONSENT =
  'No SMS permission is recorded for this lead. After they agree on a call, save the outcome "Trial link sent" or "Marketplace link sent" first.'

export const SMS_BLOCK_AGENT_OFF = "SMS is turned off for your account. Ask the admin to turn it on."

export function evaluateSmsPermission(f: SmsFacts): SmsDecision {
  if (f.doNotCall) return { allowed: false, reason: SMS_BLOCK_DNC }
  if (f.isAdmin) return { allowed: true }
  if (!f.agentSmsEnabled) return { allowed: false, reason: SMS_BLOCK_AGENT_OFF }
  if (f.hasSmsConsent || f.hasInbound) return { allowed: true }
  return { allowed: false, reason: SMS_BLOCK_NO_CONSENT }
}
