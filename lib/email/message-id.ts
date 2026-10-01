import { randomUUID } from "crypto"

// "Name <addr@host>" or plain "addr@host" -> "addr@host"
export function bareAddress(from: string): string {
  const m = from.match(/<([^>]+)>/)
  return (m ? m[1] : from).trim()
}

// Mailbox that replies should come back to — the one the IMAP sync reads.
export function replyToAddress(): string | undefined {
  return process.env.EMAIL_REPLY_TO || process.env.IMAP_USER || undefined
}

// RFC 5322 Message-ID we generate ourselves so we can save it and later match
// an inbound reply's In-Reply-To / References against it.
export function generateMessageId(fromAddress: string): string {
  const domain = bareAddress(fromAddress).split("@")[1] || "localhost"
  return `<${randomUUID()}@${domain}>`
}
