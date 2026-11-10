// Agent payout details (where commission is paid). Pure: shared by the agent form,
// the save action and the admin Payouts page.

export const PAYOUT_METHODS = [
  { id: "bank", label: "Bank transfer" },
  { id: "wise", label: "Wise" },
  { id: "payoneer", label: "Payoneer" },
  { id: "paypal", label: "PayPal" },
  { id: "other", label: "Other" },
] as const

export type PayoutMethod = (typeof PAYOUT_METHODS)[number]["id"]

export interface PayoutDetails {
  method: PayoutMethod
  account_holder: string
  country: string
  bank_name: string | null
  bank_country: string | null
  iban: string | null
  account_number: string | null
  swift_bic: string | null
  branch_or_routing: string | null
  payment_email: string | null
  address: string | null
  notes: string | null
  updated_at?: string
}

export const METHOD_LABEL: Record<PayoutMethod, string> = Object.fromEntries(PAYOUT_METHODS.map((m) => [m.id, m.label])) as Record<PayoutMethod, string>

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** IBAN check digits (ISO 13616, mod 97). Spaces are ignored. */
export function ibanValid(raw: string): boolean {
  const iban = raw.replace(/\s+/g, "").toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false
  const moved = iban.slice(4) + iban.slice(0, 4)
  let rem = 0
  for (const ch of moved) {
    const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55)
    for (const d of v) rem = (rem * 10 + Number(d)) % 97
  }
  return rem === 1
}

/** "PK36 SCBL 0000 0011 2345 6702" */
export function formatIban(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase().replace(/(.{4})/g, "$1 ").trim()
}

const clean = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null
  const s = v.trim().replace(/\s+/g, " ")
  return s ? s.slice(0, max) : null
}

/** Checks and tidies what the agent typed. */
export function validatePayoutDetails(input: Record<string, unknown>): { ok: true; value: PayoutDetails } | { ok: false; error: string } {
  const method = input.method as PayoutMethod
  if (!PAYOUT_METHODS.some((m) => m.id === method)) return { ok: false, error: "Choose how you want to be paid." }

  const v: PayoutDetails = {
    method,
    account_holder: clean(input.account_holder, 120) ?? "",
    country: clean(input.country, 80) ?? "",
    bank_name: clean(input.bank_name, 120),
    bank_country: clean(input.bank_country, 80),
    iban: clean(input.iban, 50)?.replace(/\s+/g, "").toUpperCase() ?? null,
    account_number: clean(input.account_number, 50),
    swift_bic: clean(input.swift_bic, 20)?.replace(/\s+/g, "").toUpperCase() ?? null,
    branch_or_routing: clean(input.branch_or_routing, 60),
    payment_email: clean(input.payment_email, 160)?.toLowerCase() ?? null,
    address: clean(input.address, 300),
    notes: clean(input.notes, 500),
  }

  if (v.account_holder.length < 3) return { ok: false, error: "Enter the account holder's full name." }
  if (v.country.length < 2) return { ok: false, error: "Enter the country you live in." }

  if (method === "bank") {
    if (!v.bank_name) return { ok: false, error: "Enter the bank name." }
    if (!v.bank_country) return { ok: false, error: "Enter the country of the bank." }
    if (!v.iban && !v.account_number) return { ok: false, error: "Enter your IBAN or account number." }
    if (v.iban && !ibanValid(v.iban)) return { ok: false, error: "This IBAN is not valid. Please check it." }
    if (v.swift_bic && !/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(v.swift_bic)) {
      return { ok: false, error: "SWIFT / BIC should be 8 or 11 letters and numbers." }
    }
  } else if (method === "other") {
    if (!v.notes) return { ok: false, error: "Explain in the notes how you want to be paid." }
  } else {
    if (!v.payment_email || !EMAIL_RE.test(v.payment_email)) return { ok: false, error: `Enter the email of your ${METHOD_LABEL[method]} account.` }
  }
  if (v.payment_email && !EMAIL_RE.test(v.payment_email)) return { ok: false, error: "Enter a valid payment email." }

  return { ok: true, value: v }
}
