// The one place phone numbers are parsed, validated and formatted.
//
//   toE164(anything)        -> "+12143708737" or null   (what Telnyx/Retell get)
//   parsePhone(anything)    -> { e164, ext, ... } or null
//   formatPhoneDisplay(x)   -> "(214) 370-8737"          (UI only, never sent to an API)
//
// Everything that calls, texts, matches or de-duplicates by number goes
// through this file. Isomorphic: safe in server and client components.

import {
  findNumbers,
  parsePhoneNumberFromString,
  type CountryCode,
  type PhoneNumber,
} from "libphonenumber-js"

/** Default country for numbers written without a country code. */
export const DEFAULT_COUNTRY: CountryCode = "US"

export interface ParsedPhone {
  /** Always "+<country><national>", e.g. "+12143708737". */
  e164: string
  /** Extension, kept apart from the number ("12" for "214-370-8737 x12"). */
  ext: string | null
  country: CountryCode | null
  /** "(214) 370-8737" for US/CA, "+44 20 7946 0958" for the rest. */
  display: string
}

// Characters that show up in pasted numbers and confuse parsers.
function clean(input: string): string {
  return input
    .normalize("NFKC") // fullwidth digits/plus/brackets -> ASCII
    .replace(/[   -​  ⁠　﻿]/g, " ") // NBSP & friends
    .replace(/[‐-―−﹘﹣－]/g, "-") // hyphen / en & em dash / minus
    .replace(/^\s*tel:/i, "")
    .trim()
    .replace(/^00(?=\d)/, "+") // "00 44 ..." means "+44 ..."
    .replace(/^0{2}\s+(?=\d)/, "+")
}

function toParsed(p: PhoneNumber): ParsedPhone | null {
  if (!p.isValid()) return null
  const isNanp = p.countryCallingCode === "1"
  return {
    e164: p.number,
    ext: p.ext ?? null,
    country: p.country ?? null,
    // libphonenumber appends " ext. N" itself; keep display extension-free.
    display: (isNanp ? p.formatNational() : p.formatInternational()).replace(/ ext\. .*$/, ""),
  }
}

/**
 * Parses a phone number written in any common shape. Returns null unless the
 * result is a valid number — a short, fake or garbled input never becomes
 * "usable". Text with labels or several numbers ("Phone: (214) 370-8737",
 * "214-370-8737 / 972-555-0100") yields the first valid number found.
 */
export function parsePhone(input: string | null | undefined, country: CountryCode = DEFAULT_COUNTRY): ParsedPhone | null {
  if (typeof input !== "string") return null
  const text = clean(input)
  if (!text) return null

  // 1) The whole string is one number (the common case).
  const direct = parsePhoneNumberFromString(text, country)
  if (direct) {
    const parsed = toParsed(direct)
    if (parsed) return parsed
  }

  // 2) Labels / several numbers in one string: first number in the text.
  try {
    for (const found of findNumbers(text, { defaultCountry: country, v2: true })) {
      const parsed = toParsed(found.number)
      if (parsed) return parsed
    }
  } catch {
    /* unparsable text */
  }
  return null
}

/** E.164 for any input, or null if it isn't a valid phone number. */
export function toE164(input: string | null | undefined): string | null {
  return parsePhone(input)?.e164 ?? null
}

export function isValidPhone(input: string | null | undefined): boolean {
  return parsePhone(input) !== null
}

/**
 * Pretty form for the UI. Falls back to the raw text when it isn't a valid
 * number, so nothing silently disappears from the screen.
 */
export function formatPhoneDisplay(input: string | null | undefined): string {
  if (!input) return ""
  const parsed = parsePhone(input)
  if (!parsed) return input
  return parsed.ext ? `${parsed.display} ext. ${parsed.ext}` : parsed.display
}

/** Only digits, for stable keys (e.g. synthetic MC numbers). */
export function phoneDigits(input: string): string {
  return input.normalize("NFKC").replace(/\D/g, "")
}
