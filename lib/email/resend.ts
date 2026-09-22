import { Resend } from "resend"

let _resend: Resend | null = null

export function getResend(): Resend {
  if (!_resend) {
    const key = process.env.RESEND_API_KEY
    if (!key) throw new Error("RESEND_API_KEY is not set in environment")
    _resend = new Resend(key)
  }
  return _resend
}

export const EMAIL_FROM = process.env.EMAIL_FROM ?? "onboarding@resend.dev"

// Merge-tag interpolation: {{company_name}}, {{contact_name}}, etc.
export function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`)
}
