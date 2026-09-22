/**
 * FmcsaApiProvider
 *
 * Uses the official FMCSA QCMobile API instead of the bulk census file.
 *
 * ENDPOINT / FIELD MAPPING — UNVERIFIED against a live response (no network
 * access during development). The QCMobile API is documented at
 * https://mobile.fmcsa.dot.gov/QCDevsite/docs/getStarted and is primarily a
 * single-carrier lookup API (by DOT/MC/name). This provider calls a search
 * endpoint under the base URL with broker + date-range filters; confirm the
 * exact endpoint path, query params, and response field names against your
 * FMCSA_API_KEY's actual access before the first production run, and adjust
 * the env vars / mapRecord() below if the live shape differs.
 *
 * Configure via environment variables:
 *   FMCSA_API_KEY       — required; sent as the `webKey` query param
 *   FMCSA_API_BASE_URL  — default: https://mobile.fmcsa.dot.gov/qc/services/
 *   FMCSA_API_ENDPOINT  — search path appended to base URL (default: "carriers")
 */

import type { BrokerDataProvider } from "./provider"
import type { BrokerRecord, FetchOptions } from "./types"

const BASE_URL = (
  process.env.FMCSA_API_BASE_URL ?? "https://mobile.fmcsa.dot.gov/qc/services/"
).replace(/\/?$/, "/")
const ENDPOINT = process.env.FMCSA_API_ENDPOINT ?? "carriers"
const PAGE_SIZE = 100

function apiKey(): string {
  const key = process.env.FMCSA_API_KEY
  if (!key) throw new Error("FMCSA_API_KEY not set")
  return key
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10) // YYYY-MM-DD
}

function stripMcPrefix(raw: string): string {
  return String(raw).replace(/^MC-/i, "").trim()
}

// Normalises one carrier record from the API response. FMCSA QCMobile
// responses typically wrap the carrier under a "content" key — both the
// wrapped and flat shapes are handled here defensively.
function mapRecord(raw: Record<string, unknown>): BrokerRecord | null {
  const c = (raw.content ?? raw.carrier ?? raw) as Record<string, unknown>

  const mc = (c.docketNumber ?? c.mcNumber ?? c.mc_number ?? "") as string
  if (!mc) return null

  const authorityType = String(c.authorityType ?? c.carrierOperation ?? "").toUpperCase()
  if (authorityType && !authorityType.includes("BROKER")) return null

  const companyName = (c.legalName ?? c.dbaName ?? c.name ?? "") as string
  if (!companyName) return null

  const regRaw = (c.addDate ?? c.mcs150FormDate ?? c.registrationDate) as string | undefined
  const registrationDate = regRaw ? new Date(regRaw) : undefined

  const physicalAddress = c.physicalAddress as Record<string, unknown> | undefined

  return {
    mcNumber: stripMcPrefix(mc),
    dotNumber: c.dotNumber ? String(c.dotNumber) : undefined,
    companyName,
    email: (c.emailAddress as string) || undefined,
    phone: (c.telephone as string) || (c.phone as string) || undefined,
    addressLine1: (c.phyStreet as string) || (physicalAddress?.street as string) || undefined,
    city: (c.phyCity as string) || (physicalAddress?.city as string) || undefined,
    state: (c.phyState as string) || (physicalAddress?.state as string) || undefined,
    zip: (c.phyZipcode as string) || (physicalAddress?.zipCode as string) || undefined,
    authorityStatus: (c.statusCode as string) || (c.authorityStatus as string) || undefined,
    registrationDate:
      registrationDate && !isNaN(registrationDate.getTime()) ? registrationDate : undefined,
  }
}

export class FmcsaApiProvider implements BrokerDataProvider {
  readonly name = "FMCSA QCMobile API"

  async fetchBrokers(options?: FetchOptions): Promise<BrokerRecord[]> {
    const since =
      options?.since ??
      (() => {
        const d = new Date()
        d.setDate(d.getDate() - 30)
        return d
      })()
    const limit = options?.limit ?? Infinity

    const results: BrokerRecord[] = []
    let offset = 0

    while (results.length < limit) {
      const url = new URL(ENDPOINT, BASE_URL)
      url.searchParams.set("webKey", apiKey())
      url.searchParams.set("authorityType", "BROKER")
      url.searchParams.set("startDate", formatDate(since))
      url.searchParams.set("endDate", formatDate(new Date()))
      url.searchParams.set("size", String(PAGE_SIZE))
      url.searchParams.set("offset", String(offset))

      const res = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
      })
      if (!res.ok) {
        throw new Error(
          `FMCSA API request failed: ${res.status} ${res.statusText} — ${url.toString()}`,
        )
      }
      const json = await res.json()
      const rows = (json.content ?? json.results ?? json.carriers ?? (Array.isArray(json) ? json : [])) as Record<
        string,
        unknown
      >[]
      if (rows.length === 0) break

      for (const row of rows) {
        const broker = mapRecord(row)
        if (!broker) continue
        if (broker.registrationDate && broker.registrationDate < since) continue
        results.push(broker)
        if (results.length >= limit) break
      }

      if (rows.length < PAGE_SIZE) break // last page
      offset += PAGE_SIZE
    }

    return results
  }
}
