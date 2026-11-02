import { maskEmail } from "@/lib/mask"

export const EMAIL_INBOX_SELECT = `
  id, lead_id, direction, status, subject, message_body, from_email, to_email,
  message_id, send_error, read_at, occurred_at,
  leads ( id, brokers ( company_name, contact_name ) )
`

/**
 * The agent's copy of the email inbox: the broker's address (the sender of
 * inbound mail, the recipient of outbound mail) is masked. Threads still group
 * by lead, and replies find the address on the server from the parent email.
 */
export function maskEmailEventsForAgent<
  T extends { direction: string; from_email: string | null; to_email: string | null },
>(events: T[]): T[] {
  return events.map((e) =>
    e.direction === "inbound" ? { ...e, from_email: maskEmail(e.from_email) } : { ...e, to_email: maskEmail(e.to_email) },
  )
}
