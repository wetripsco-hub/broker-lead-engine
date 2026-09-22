/**
 * QCMobile enrichment
 *
 * The FMCSA QCMobile API is lookup-only (confirmed against a live response —
 * no listing/search/date-range endpoint exists). It cannot discover new
 * broker registrations, so it is NOT a BrokerDataProvider. Instead,
 * IngestionService calls enrichBrokerFromQcMobile() per MC number *after*
 * FmcsaCensusProvider has discovered which brokers are new/changed, to
 * refresh each one with a live status/address lookup.
 *
 * Verified endpoint + response shape (2026-09-22, live call):
 *   GET https://mobile.fmcsa.dot.gov/qc/services/carriers/docket-number/{mc}?webKey=...
 *   { "content": [ { "carrier": { "dotNumber", "legalName", "dbaName",
 *       "phyStreet", "phyCity", "phyState", "phyZipcode", "statusCode",
 *       "brokerAuthorityStatus", ... } } ], "retrievalDate": "..." }
 *
 * Note: this endpoint has no email/phone/registration-date fields — those
 * still come from the census file and are left untouched by enrichment.
 *
 * Configure via environment variables:
 *   FMCSA_API_KEY       — required; sent as the `webKey` query param.
 *                          Enrichment is skipped (not fatal) if unset.
 *   FMCSA_API_BASE_URL  — default: https://mobile.fmcsa.dot.gov/qc/services/
 */

import type { BrokerRecord } from "./types"

const BASE_URL = (
  process.env.FMCSA_API_BASE_URL ?? "https://mobile.fmcsa.dot.gov/qc/services/"
).replace(/\/?$/, "/")

interface QcMobileCarrier {
  dotNumber?: number | string
  legalName?: string
  dbaName?: string | null
  phyStreet?: string
  phyCity?: string
  phyState?: string
  phyZipcode?: string
  statusCode?: string
  brokerAuthorityStatus?: string
}

/**
 * Looks up one carrier by MC (docket) number and returns the fields worth
 * refreshing. Returns null on any failure (missing key, 4xx/5xx, unexpected
 * shape, no match) — enrichment is a best-effort refresh, never fatal to
 * the ingestion run.
 */
export async function enrichBrokerFromQcMobile(
  mcNumber: string,
): Promise<Partial<BrokerRecord> | null> {
  const key = process.env.FMCSA_API_KEY
  if (!key) return null

  try {
    const url = new URL(`carriers/docket-number/${encodeURIComponent(mcNumber)}`, BASE_URL)
    url.searchParams.set("webKey", key)

    const res = await fetch(url.toString(), { headers: { Accept: "application/json" } })
    if (!res.ok) return null

    const json = (await res.json()) as { content?: Array<{ carrier?: QcMobileCarrier }> }
    const carrier = json.content?.[0]?.carrier
    if (!carrier) return null

    return {
      dotNumber: carrier.dotNumber ? String(carrier.dotNumber) : undefined,
      companyName: carrier.legalName || carrier.dbaName || undefined,
      addressLine1: carrier.phyStreet || undefined,
      city: carrier.phyCity || undefined,
      state: carrier.phyState || undefined,
      zip: carrier.phyZipcode || undefined,
      authorityStatus:
        carrier.statusCode === "A" ? "ACTIVE" : carrier.statusCode || undefined,
    }
  } catch {
    return null
  }
}

/** Enriches a batch of records, capping concurrency to avoid hammering the API. */
export async function enrichBrokers(
  records: BrokerRecord[],
  concurrency = 5,
): Promise<BrokerRecord[]> {
  const out = [...records]
  for (let i = 0; i < out.length; i += concurrency) {
    const chunk = out.slice(i, i + concurrency)
    const enrichments = await Promise.all(
      chunk.map((r) => enrichBrokerFromQcMobile(r.mcNumber)),
    )
    enrichments.forEach((enriched, j) => {
      if (enriched) Object.assign(out[i + j], enriched)
    })
  }
  return out
}
