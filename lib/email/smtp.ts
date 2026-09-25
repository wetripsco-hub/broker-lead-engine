import nodemailer, { type Transporter } from "nodemailer"

let _transporter: Transporter | null = null

function getTransporter(): Transporter {
  if (!_transporter) {
    const host = process.env.SMTP_HOST
    const port = process.env.SMTP_PORT
    const user = process.env.SMTP_USER
    const pass = process.env.SMTP_PASS
    if (!host || !port || !user || !pass) {
      throw new Error("SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASS must all be set")
    }
    _transporter = nodemailer.createTransport({
      host,
      port: Number(port),
      secure: Number(port) === 465,
      auth: { user, pass },
    })
  }
  return _transporter
}

export const SMTP_FROM = process.env.SMTP_FROM ?? process.env.SMTP_USER ?? ""

export async function sendViaSmtp(params: {
  to: string
  subject: string
  text: string
  html?: string
}): Promise<{ id: string | null; error: string | null }> {
  try {
    const info = await getTransporter().sendMail({
      from: SMTP_FROM,
      to: params.to,
      subject: params.subject,
      text: params.text,
      html: params.html,
    })
    return { id: info.messageId ?? null, error: null }
  } catch (err) {
    return { id: null, error: err instanceof Error ? err.message : String(err) }
  }
}
