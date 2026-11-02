// Masked broker contact data for agents. Agents never see a full phone number
// or email address on screen; admins always get the real values.
//
//   maskPhone("+13125550147")                -> "(312) •••-••47"
//   maskEmail("john.smith@acmelogistics.com") -> "j•••@a•••.com"
//
// The area code stays visible because the broker's local time is worked out
// from it when there's no state. Isomorphic: safe in server and client code.

import { parsePhone } from "@/lib/phone"

const DOTS = "•••"

export function maskPhone(input: string | null | undefined): string | null {
  if (input === null || input === undefined || !input.trim()) return null
  const p = parsePhone(input)
  if (!p) return DOTS
  const digits = p.e164.replace(/\D/g, "")
  const last2 = digits.slice(-2)
  // NANP: +1 and ten digits.
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${DOTS}-••${last2}`
  }
  return `${DOTS} ••${last2}`
}

export function maskEmail(input: string | null | undefined): string | null {
  if (input === null || input === undefined || !input.trim()) return null
  const s = input.trim()
  const at = s.lastIndexOf("@")
  if (at <= 0 || at === s.length - 1) return DOTS
  const local = s.slice(0, at)
  const domain = s.slice(at + 1)
  const dot = domain.lastIndexOf(".")
  if (dot <= 0 || dot === domain.length - 1) return DOTS
  return `${local[0]}${DOTS}@${domain[0]}${DOTS}${domain.slice(dot)}`
}

/** True for a value produced by maskPhone / maskEmail. */
export function isMasked(value: string | null | undefined): boolean {
  return !!value && value.includes("•")
}

/**
 * A phone string that `resolveTimezone` can read the area code from. Real
 * numbers come back unchanged; a masked "(312) •••-••47" becomes a dummy
 * number with the same area code (never dialled, only used for the time zone).
 */
export function timezonePhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  if (!isMasked(phone)) return phone
  const m = phone.match(/^\((\d{3})\)/)
  return m ? `${m[1]}5550100` : null
}

/** Masks only when `masked` is true — the one switch used by pages. */
export function phoneFor(masked: boolean, phone: string | null | undefined): string | null {
  return masked ? maskPhone(phone) : (phone ?? null)
}

export function emailFor(masked: boolean, email: string | null | undefined): string | null {
  return masked ? maskEmail(email) : (email ?? null)
}
