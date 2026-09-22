/**
 * FmcsaCensusProvider
 *
 * Discovery source: fetches the FMCSA Motor Carrier Census 1 file
 * (pipe-delimited .txt inside a .zip), filters for newly registered
 * brokers, and returns normalised BrokerRecord objects.
 *
 * The QCMobile API (see api-provider.ts) is lookup-only — given a known
 * DOT/MC number it returns an accurate live profile, but it has no
 * listing/search/date-range endpoint. This provider is what actually
 * discovers *which* MC numbers are new; IngestionService then enriches
 * each new/updated broker with a QCMobile lookup for live status data.
 *
 * FIELD MAPPING — UNVERIFIED against live FMCSA download (site blocked
 * during development). Field names are sourced from FMCSA Census File
 * layout documentation (training data). Verify against actual file
 * header row before first production run, and adjust env var overrides
 * below if needed.
 *
 * Configure via environment variables:
 *   FMCSA_CENSUS1_URL     — direct URL to the Census1 .zip or .txt
 *                           default: https://www.fmcsa.dot.gov/sites/fmcsa.dot.gov/files/docs/licensing-and-insurance/data-and-statistics/census-downloads/current/FMCSA_CENSUS1.zip
 *   FMCSA_DELIMITER       — field separator (default: "|")
 *   FMCSA_ENTITY_TYPE_COL — column name for entity type (default: "CARRIER_OPERATION")
 *   FMCSA_ENTITY_TYPE_VAL — value that identifies a broker (default: "BROKER")
 *   FMCSA_DATE_COL        — column name for registration date (default: "ADD_DATE")
 *   FMCSA_DATE_FORMAT     — "YYYYMMDD" | "YYYY-MM-DD" (default: "YYYYMMDD")
 */

import { parse } from "csv-parse"
import unzipper from "unzipper"
import { Readable } from "stream"
import type { BrokerDataProvider } from "./provider"
import type { BrokerRecord, FetchOptions } from "./types"

const CENSUS_URL =
  process.env.FMCSA_CENSUS1_URL ??
  "https://www.fmcsa.dot.gov/sites/fmcsa.dot.gov/files/docs/licensing-and-insurance/data-and-statistics/census-downloads/current/FMCSA_CENSUS1.zip"

const DELIMITER = process.env.FMCSA_DELIMITER ?? "|"
const ENTITY_COL = process.env.FMCSA_ENTITY_TYPE_COL ?? "CARRIER_OPERATION"
const ENTITY_VAL = process.env.FMCSA_ENTITY_TYPE_VAL ?? "BROKER"
const DATE_COL = process.env.FMCSA_DATE_COL ?? "ADD_DATE"
const DATE_FMT = (process.env.FMCSA_DATE_FORMAT ?? "YYYYMMDD") as "YYYYMMDD" | "YYYY-MM-DD"

function parseDate(raw: string): Date | undefined {
  if (!raw) return undefined
  if (DATE_FMT === "YYYYMMDD" && raw.length === 8) {
    return new Date(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`)
  }
  const d = new Date(raw)
  return isNaN(d.getTime()) ? undefined : d
}

function stripMcPrefix(raw: string): string {
  return raw.replace(/^MC-/i, "").trim()
}

function mapRow(row: Record<string, string>): BrokerRecord | null {
  const mc = row["MC_MX_FF_NUMBER"] ?? row["MC_NUMBER"] ?? ""
  if (!mc || !mc.toUpperCase().startsWith("MC")) return null

  const entityType = (row[ENTITY_COL] ?? "").toUpperCase()
  if (!entityType.includes(ENTITY_VAL.toUpperCase())) return null

  const companyName = row["LEGAL_NAME"] ?? row["DBA_NAME"] ?? ""
  if (!companyName) return null

  return {
    mcNumber: stripMcPrefix(mc),
    dotNumber: row["DOT_NUMBER"] || undefined,
    companyName,
    email: row["EMAIL_ADDRESS"] || undefined,
    phone: row["TELEPHONE"] || undefined,
    addressLine1: row["PHY_STREET"] || undefined,
    city: row["PHY_CITY"] || undefined,
    state: row["PHY_STATE"] || undefined,
    zip: row["PHY_ZIP"] || undefined,
    authorityStatus: row["RECORD_STATUS_DESC"] || undefined,
    registrationDate: parseDate(row[DATE_COL] ?? ""),
  }
}

async function streamCensusFile(url: string): Promise<Readable> {
  const response = await fetch(url, {
    headers: { "User-Agent": "BrokerLeadEngine/1.0 (+contact@yourcompany.com)" },
  })
  if (!response.ok) {
    throw new Error(`FMCSA fetch failed: ${response.status} ${response.statusText} — URL: ${url}`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())

  const isZip = url.toLowerCase().endsWith(".zip")
  if (!isZip) {
    // Plain text/CSV — bail out with a clear error if this looks like an
    // HTML block/error page instead of the expected delimited data.
    const head = buffer.subarray(0, 200).toString("utf-8").trimStart()
    if (head.startsWith("<") || /^\s*<!doctype html/i.test(head)) {
      throw new Error(
        `FMCSA returned HTML instead of the census file — likely blocked/redirected ` +
          `(WAF, geo/IP block, or auth wall). URL: ${url} — Response starts with: ${head.slice(0, 150)}`,
      )
    }
    return Readable.from(buffer)
  }

  // ZIP: validate the local-file-header magic bytes ("PK\x03\x04") before
  // handing it to unzipper — a non-ZIP body (e.g. an HTML block page) makes
  // unzipper crash internally with an opaque "Cannot read properties of
  // null (reading 'length')" instead of a useful error.
  const isValidZip = buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b
  if (!isValidZip) {
    const head = buffer.subarray(0, 200).toString("utf-8").trimStart()
    throw new Error(
      `FMCSA did not return a valid ZIP file — likely blocked/redirected ` +
        `(WAF, geo/IP block, or auth wall). URL: ${url} — Response starts with: ${head.slice(0, 150)}`,
    )
  }

  const directory = await unzipper.Open.buffer(buffer)
  const txtEntry = directory.files.find((f: { path: string }) => f.path.endsWith(".txt") || f.path.endsWith(".csv"))
  if (!txtEntry) throw new Error("No .txt/.csv file found inside FMCSA census ZIP")
  return txtEntry.stream()
}

export class FmcsaCensusProvider implements BrokerDataProvider {
  readonly name = "FMCSA Census 1 (bulk file — discovery)"

  async fetchBrokers(options?: FetchOptions): Promise<BrokerRecord[]> {
    const since = options?.since
    const limit = options?.limit ?? Infinity

    const stream = await streamCensusFile(CENSUS_URL)
    const parser = stream.pipe(
      parse({
        delimiter: DELIMITER,
        columns: true,         // first row = headers
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
      })
    )

    const results: BrokerRecord[] = []

    for await (const row of parser) {
      const broker = mapRow(row as Record<string, string>)
      if (!broker) continue
      if (since && broker.registrationDate && broker.registrationDate < since) continue
      results.push(broker)
      if (results.length >= limit) break
    }

    return results
  }
}
