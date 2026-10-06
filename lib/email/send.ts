import { getResend, EMAIL_FROM } from "@/lib/email/resend"
import { sendViaSmtp, SMTP_FROM } from "@/lib/email/smtp"

export interface SendEmailResult {
  id: string | null
  error: string | null
}

export type EmailProvider = "smtp" | "resend"

export function smtpConfigured(): boolean {
  return Boolean(
    process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASS,
  )
}

// Provider for threaded conversation replies: SMTP whenever it's set up (it
// honours Message-ID / In-Reply-To / References exactly, which is what makes
// a reply thread in the broker's mail client), otherwise whatever
// EMAIL_PROVIDER says.
export function conversationProvider(): EmailProvider | undefined {
  return smtpConfigured() ? "smtp" : undefined
}

function activeProvider(override?: EmailProvider): EmailProvider {
  return override ?? (process.env.EMAIL_PROVIDER === "smtp" ? "smtp" : "resend")
}

// The address mail actually goes out from, for whichever provider is active.
export function fromAddress(provider?: EmailProvider): string {
  return activeProvider(provider) === "smtp" ? SMTP_FROM : EMAIL_FROM
}

// Single entry point for all outbound email. Provider is chosen by
// EMAIL_PROVIDER ("smtp" | "resend"); defaults to resend for backward
// compatibility with existing deployments that only set RESEND_API_KEY.
//
// messageId / replyTo / inReplyTo / references are what make a platform
// reply thread correctly in the broker's mail client and let the IMAP sync
// match their answer back to this message. SMTP honours all of them; with
// Resend they're passed as headers, but Resend may rewrite Message-ID — if
// threading by header matters, use EMAIL_PROVIDER=smtp (sender-address
// matching still works as a fallback either way).
export async function sendEmail(params: {
  to: string
  subject: string
  text: string
  html?: string
  messageId?: string
  replyTo?: string
  inReplyTo?: string
  references?: string
  provider?: EmailProvider
}): Promise<SendEmailResult> {
  const provider = activeProvider(params.provider)
  if (!fromAddress(provider)) {
    return {
      id: null,
      error: provider === "smtp" ? "SMTP_FROM (or SMTP_USER) is not set" : "EMAIL_FROM is not set",
    }
  }
  if (provider === "smtp") {
    return sendViaSmtp(params)
  }

  const headers: Record<string, string> = {}
  if (params.messageId) headers["Message-ID"] = params.messageId
  if (params.inReplyTo) headers["In-Reply-To"] = params.inReplyTo
  if (params.references) headers["References"] = params.references

  try {
    const resend = getResend()
    const { data, error } = await resend.emails.send({
      from: EMAIL_FROM,
      to: params.to,
      subject: params.subject,
      text: params.text,
      ...(params.html ? { html: params.html } : {}),
      ...(params.replyTo ? { replyTo: params.replyTo } : {}),
      ...(Object.keys(headers).length ? { headers } : {}),
    })
    if (error) return { id: null, error: error.message }
    return { id: data?.id ?? null, error: null }
  } catch (err) {
    return { id: null, error: err instanceof Error ? err.message : String(err) }
  }
}
