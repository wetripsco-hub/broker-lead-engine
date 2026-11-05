// The agent's own location / time zone, from the IP they connect from.
// Pure functions (no headers(), no DB) so they can be tested with fixed input.
// Used only to DISPLAY times; the calling rules use the broker's time zone.

import { AGENT_TZ, isValidTimezone, timezoneAbbr } from "@/lib/timezone/broker-time"

export interface IpLocation {
  timezone: string
  country: string | null
  city: string | null
}

/** Location of one request; `timezone` null = no IP header (use the browser's zone). */
export interface RequestLocation {
  timezone: string | null
  country: string | null
  city: string | null
}

/** "Dubai, United Arab Emirates", or null when neither is known. */
export function placeName(city: string | null | undefined, country: string | null | undefined): string | null {
  const place = [city, countryName(country)].filter(Boolean).join(", ")
  return place || null
}

/** Fallback order: Vercel IP header → browser zone → Asia/Karachi. Each is validated. */
export function pickTimezone(headerTz: string | null | undefined, browserTz: string | null | undefined): string {
  if (isValidTimezone(headerTz)) return headerTz
  if (isValidTimezone(browserTz)) return browserTz
  return AGENT_TZ
}

/** Vercel sends the city URL-encoded ("S%C3%A3o%20Paulo"). */
export function decodeCity(raw: string | null | undefined): string | null {
  if (!raw) return null
  let city = raw
  try {
    city = decodeURIComponent(raw)
  } catch {
    /* keep the raw value */
  }
  city = city.trim().slice(0, 100)
  return city || null
}

/** Two-letter country code, upper-cased, or null. */
export function normaliseCountry(raw: string | null | undefined): string | null {
  const c = (raw ?? "").trim().toUpperCase()
  return /^[A-Z]{2}$/.test(c) ? c : null
}

/** Location from Vercel's request headers, with the browser zone as a fallback. */
export function locationFromHeaders(
  get: (name: string) => string | null,
  browserTz: string | null | undefined,
): IpLocation {
  return {
    timezone: pickTimezone(get("x-vercel-ip-timezone"), browserTz),
    country: normaliseCountry(get("x-vercel-ip-country")),
    city: decodeCity(get("x-vercel-ip-city")),
  }
}

/** Whether the saved row needs writing (so the heartbeat doesn't write every minute). */
export function locationChanged(
  saved: { ip_timezone: string | null; ip_country: string | null; ip_city: string | null } | null,
  next: IpLocation,
): boolean {
  if (!saved) return true
  return saved.ip_timezone !== next.timezone || saved.ip_country !== next.country || saved.ip_city !== next.city
}

/** "NG" → "Nigeria". Falls back to the code. */
export function countryName(code: string | null | undefined): string | null {
  if (!code) return null
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code
  } catch {
    return code
  }
}

/** "UTC+1", "UTC+5:30", "UTC−4", "UTC" at `at`. */
export function utcOffsetLabel(tz: string, at: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(at)
  const raw = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT"
  const m = raw.match(/^GMT([+-])(\d{2}):(\d{2})$/)
  if (!m) return "UTC"
  const hours = String(Number(m[2]))
  return `UTC${m[1] === "-" ? "−" : "+"}${hours}${m[3] === "00" ? "" : `:${m[3]}`}`
}

/** "Lagos, Nigeria · WAT (UTC+1)" — for the admin's Agents page. */
export function describeLocation(loc: { city: string | null; country: string | null; timezone: string }, at: Date): string {
  const place = placeName(loc.city, loc.country)
  const zone = `${timezoneAbbr(loc.timezone, at)} (${utcOffsetLabel(loc.timezone, at)})`
  return place ? `${place} · ${zone}` : zone
}
