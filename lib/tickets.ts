// Support tickets: an agent asks the admin something — about a client (a lead)
// or their own question — and the admin answers in the same thread.
// Pure rules shared by the server actions and the tests.

export type TicketTopic = "client" | "own"
export type TicketStatus = "open" | "answered" | "closed"

export const TOPIC_LABEL: Record<TicketTopic, string> = {
  client: "About a client",
  own: "My own question",
}

export const STATUS_LABEL: Record<TicketStatus, string> = {
  open: "Waiting for admin",
  answered: "Answered",
  closed: "Closed",
}

export const SUBJECT_MAX = 150
export const BODY_MAX = 5000

export interface NewTicketInput {
  topic: string
  subject: string
  body: string
  leadId: string | null
}

export type ValidTicket = { topic: TicketTopic; subject: string; body: string; leadId: string | null }

export function validateNewTicket(i: NewTicketInput): { ok: true; value: ValidTicket } | { ok: false; error: string } {
  if (i.topic !== "client" && i.topic !== "own") return { ok: false, error: "Choose what the ticket is about." }
  const subject = i.subject.trim()
  const body = i.body.trim()
  if (!subject) return { ok: false, error: "Write a short subject." }
  if (subject.length > SUBJECT_MAX) return { ok: false, error: `Subject is too long (max ${SUBJECT_MAX} characters).` }
  if (!body) return { ok: false, error: "Describe your question." }
  if (body.length > BODY_MAX) return { ok: false, error: `Message is too long (max ${BODY_MAX} characters).` }
  if (i.topic === "client" && !i.leadId) return { ok: false, error: "Pick the client (lead) this is about." }
  return { ok: true, value: { topic: i.topic, subject, body, leadId: i.topic === "client" ? i.leadId : null } }
}

export function validateReply(body: string): { ok: true; body: string } | { ok: false; error: string } {
  const b = body.trim()
  if (!b) return { ok: false, error: "Write a reply first." }
  if (b.length > BODY_MAX) return { ok: false, error: `Message is too long (max ${BODY_MAX} characters).` }
  return { ok: true, body: b }
}

/**
 * Status after a reply. The admin answering marks it answered; the agent
 * writing again (also on a closed ticket) puts it back in the admin's queue.
 */
export function statusAfterReply(fromAdmin: boolean): TicketStatus {
  return fromAdmin ? "answered" : "open"
}

/** Subject from the company and the start of the question, cut to the limit. */
export function supportSubject(company: string | null, question: string): string {
  const q = question.trim().replace(/\s+/g, " ")
  const base = `Client question${company ? ` (${company})` : ""}: ${q}`
  return base.length > SUBJECT_MAX ? `${base.slice(0, SUBJECT_MAX - 1)}…` : base
}
