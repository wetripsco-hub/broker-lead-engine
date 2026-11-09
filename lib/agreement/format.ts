// Types and date formatting shared by server and client code (no server imports here).

export type AgreementStatus = "signed" | "account_created" | "rejected"

export interface AgreementRow {
  id: string
  reference: string
  full_name: string
  email: string
  country: string
  agreement_version: string
  agreement_sha256: string
  signed_at: string
  ip: string | null
  user_agent: string | null
  status: AgreementStatus
  agent_user_id: string | null
  admin_note: string | null
}

const fmt = (tz: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })

/** "09 Nov 2026, 19:56 PKT" */
export function formatPkt(iso: string): string {
  return `${fmt("Asia/Karachi").format(new Date(iso))} PKT`
}

/** "09 Nov 2026, 14:56 UTC" */
export function formatUtc(iso: string): string {
  return `${fmt("UTC").format(new Date(iso))} UTC`
}
