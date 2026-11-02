import { maskPhone } from "@/lib/mask"

export const SMS_INBOX_SELECT = `
  id, lead_id, direction, message_body, status, occurred_at,
  from_number, to_number, read_at,
  leads ( id, brokers ( company_name, contact_name, phone ) )
`

/** Conversation key for an agent: the lead, never the number. */
export const leadConversationKey = (leadId: string) => `lead:${leadId}`

/**
 * The agent's copy of the SMS inbox: every number masked, and each event
 * carries `conv_key` so conversations still group by lead without the real
 * number. (Agents only ever see events tied to their own leads — RLS.)
 */
export function maskSmsEventsForAgent<
  T extends {
    lead_id: string | null
    from_number: string | null
    to_number: string | null
    leads: { brokers: { phone: string | null } | null } | null
  },
>(events: T[]): Array<T & { conv_key: string | null }> {
  return events.map((e) => ({
    ...e,
    from_number: maskPhone(e.from_number),
    to_number: maskPhone(e.to_number),
    leads: e.leads
      ? { ...e.leads, brokers: e.leads.brokers ? { ...e.leads.brokers, phone: maskPhone(e.leads.brokers.phone) } : null }
      : null,
    conv_key: e.lead_id ? leadConversationKey(e.lead_id) : null,
  }))
}
