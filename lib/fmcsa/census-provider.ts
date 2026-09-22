/**
 * FmcsaCensusProvider
 *
 * Discovery source: parses an admin-uploaded FMCSA Motor Carrier Census 1
 * file (pipe-delimited .txt, optionally inside a .zip), filters for
 * newly registered brokers, and returns normalised BrokerRecord objects.
 *
 * FMCSA blocks cloud/datacenter IPs (confirmed 403 from both this app's
 * dev sandbox and Vercel's production servers) — a live server-side fetch
 * of the census file is not possible. Instead, an admin downloads the file
 * from fmcsa.dot.gov in their own browser and uploads it from the
 * Ingestion Log page; it lands in the `census-uploads` Supabase Storage
 * bucket at `latest.bin`, and this provider reads it from there.
 *
 * The QCMobile API (see api-provider.ts) is lookup-only — given a known
 * DOT/MC number it returns an accurate live profile, but it has no
 * listing/search/date-range endpoint. This provider is what discovers
 * *which* MC numbers are new; IngestionService then enriches each
 * new/updated broker with a QCMobile lookup for live status data.
 *
 * FIELD MAPPING — UNVERIFIED against a live census file (FMCSA blocks
 * automated downloads, see above). Field names are sourced from FMCSA
 * Census File layout documentation (training data). Verify against the
 * actual file header row after your first upload, and adjust env var
 * overrides below if needed.
 *
 * Configure via environment variables:
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
import { createAdminClient } from "@/lib/supabase/admin"

export const CENSUS_BUCKET = "census-uploads"
export const CENSUS_OBJECT_PATH = "latest.bin"

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

async function loadUploadedCensusFile(): Promise<Readable> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.storage
    .from(CENSUS_BUCKET)
    .download(CENSUS_OBJECT_PATH)

  if (error || !data) {
    throw new Error(
      "No census file has been uploaded yet. Download the FMCSA Census 1 " +
        "file from fmcsa.dot.gov in your own browser and upload it from " +
        "the Ingestion Log page — FMCSA blocks automated downloads from " +
        "cloud servers, so this step can't be done automatically.",
    )
  }

  const buffer = Buffer.from(await data.arrayBuffer())

  // ZIP: validate the local-file-header magic bytes ("PK\x03\x04") before
  // handing it to unzipper — a non-ZIP body makes unzipper crash internally
  // with an opaque "Cannot read properties of null (reading 'length')"
  // instead of a useful error.
  const isZip = buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b
  if (isZip) {
    const directory = await unzipper.Open.buffer(buffer)
    const txtEntry = directory.files.find(
      (f: { path: string }) => f.path.endsWith(".txt") || f.path.endsWith(".csv"),
    )
    if (!txtEntry) throw new Error("No .txt/.csv file found inside the uploaded census ZIP")
    return txtEntry.stream()
  }

  return Readable.from(buffer)
}

export class FmcsaCensusProvider implements BrokerDataProvider {
  readonly name = "FMCSA Census 1 (admin-uploaded file)"

  async fetchBrokers(options?: FetchOptions): Promise<BrokerRecord[]> {
    const since = options?.since
    const limit = options?.limit ?? Infinity

    const stream = await loadUploadedCensusFile()
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
