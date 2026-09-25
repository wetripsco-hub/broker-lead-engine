import { getResend, EMAIL_FROM } from "@/lib/email/resend"
import { sendViaSmtp } from "@/lib/email/smtp"

export interface SendEmailResult {
  id: string | null
  error: string | null
}

// Single entry point for all outbound email. Provider is chosen by
// EMAIL_PROVIDER ("smtp" | "resend"); defaults to resend for backward
// compatibility with existing deployments that only set RESEND_API_KEY.
export async function sendEmail(params: {
  to: string
  subject: string
  text: string
  html?: string
}): Promise<SendEmailResult> {
  const provider = process.env.EMAIL_PROVIDER ?? "resend"

  if (provider === "smtp") {
    return sendViaSmtp(params)
  }

  try {
    const resend = getResend()
    const { data, error } = await resend.emails.send({
      from: EMAIL_FROM,
      to: params.to,
      subject: params.subject,
      text: params.text,
      ...(params.html ? { html: params.html } : {}),
    })
    if (error) return { id: null, error: error.message }
    return { id: data?.id ?? null, error: null }
  } catch (err) {
    return { id: null, error: err instanceof Error ? err.message : String(err) }
  }
}
