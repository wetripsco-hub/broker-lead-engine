// info@loadlinkers.co mailbox for the Recruiter tab: Spacemail SMTP (send)
// and IMAP (read-only). Server-only env vars; never sent to the browser.
import nodemailer, { type Transporter } from "nodemailer"
import { ImapFlow } from "imapflow"
import { randomUUID } from "crypto"

export function recruitSmtpConfigured(): boolean {
  return Boolean(process.env.RECRUIT_SMTP_HOST && process.env.RECRUIT_SMTP_USER && process.env.RECRUIT_SMTP_PASS)
}
export function recruitImapConfigured(): boolean {
  return Boolean(process.env.RECRUIT_IMAP_HOST && process.env.RECRUIT_IMAP_USER && process.env.RECRUIT_IMAP_PASS)
}

export function recruitMailbox(): string {
  return (process.env.RECRUIT_SMTP_USER || process.env.RECRUIT_IMAP_USER || "info@loadlinkers.co").trim().toLowerCase()
}

export function recruitFrom(): string {
  const name = (process.env.RECRUIT_FROM_NAME || "Loadlinkers Sales Team").replace(/["\r\n]/g, "")
  return `"${name}" <${recruitMailbox()}>`
}

/** Sending pace (configurable). Defaults: one every 20–30 s, at most 100 an hour. */
export function sendPace(): { minSeconds: number; maxSeconds: number; maxPerHour: number } {
  const num = (v: string | undefined, d: number) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d)
  const minSeconds = num(process.env.RECRUIT_SEND_MIN_SECONDS, 20)
  const maxSeconds = Math.max(minSeconds, num(process.env.RECRUIT_SEND_MAX_SECONDS, 30))
  return { minSeconds, maxSeconds, maxPerHour: num(process.env.RECRUIT_MAX_PER_HOUR, 100) }
}

let transporter: Transporter | null = null
function smtp(): Transporter {
  if (!transporter) {
    const host = process.env.RECRUIT_SMTP_HOST
    const port = Number(process.env.RECRUIT_SMTP_PORT ?? 465)
    const user = process.env.RECRUIT_SMTP_USER
    const pass = process.env.RECRUIT_SMTP_PASS
    if (!host || !user || !pass) throw new Error("Recruiter email is not set up (RECRUIT_SMTP_HOST / USER / PASS missing in Vercel).")
    transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } })
  }
  return transporter
}

export function newMessageId(): string {
  const domain = recruitMailbox().split("@")[1] || "loadlinkers.co"
  return `<${randomUUID()}@${domain}>`
}

export async function sendRecruitEmail(p: {
  to: string
  subject: string
  text: string
  html: string
  messageId: string
  inReplyTo?: string | null
  references?: string | null
}): Promise<void> {
  await smtp().sendMail({
    from: recruitFrom(),
    to: p.to,
    replyTo: recruitMailbox(),
    subject: p.subject,
    text: p.text,
    html: p.html,
    messageId: p.messageId,
    inReplyTo: p.inReplyTo ?? undefined,
    references: p.references ?? undefined,
  })
}

export function recruitImap(): ImapFlow {
  const host = process.env.RECRUIT_IMAP_HOST
  const user = process.env.RECRUIT_IMAP_USER
  const pass = process.env.RECRUIT_IMAP_PASS
  const port = Number(process.env.RECRUIT_IMAP_PORT ?? 993)
  if (!host || !user || !pass) throw new Error("Recruiter inbox is not set up (RECRUIT_IMAP_HOST / USER / PASS missing in Vercel).")
  return new ImapFlow({ host, port, secure: port === 993, auth: { user, pass }, logger: false })
}

export const RECRUIT_MAILBOX_NAME = "INBOX"
export const RECRUIT_SYNC_KEY = "recruit-inbox"
