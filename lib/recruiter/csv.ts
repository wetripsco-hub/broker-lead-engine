// CSV upload for recruits: parse, validate, and report duplicates before import.
import { parse } from "csv-parse/sync"

export const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[a-z]{2,}$/i

export interface CsvRow {
  line: number
  name: string
  email: string
}

export interface CsvPreview {
  valid: CsvRow[]
  invalid: Array<CsvRow & { reason: string }>
  duplicateInFile: CsvRow[]
  alreadyExists: CsvRow[]
  error: string | null
}

const NAME_HEADERS = ["name", "full name", "full_name", "fullname", "candidate", "candidate name"]
const FIRST_HEADERS = ["first name", "first_name", "firstname"]
const LAST_HEADERS = ["last name", "last_name", "lastname"]
const EMAIL_HEADERS = ["email", "e-mail", "email address", "email_address", "mail"]

export function normaliseEmail(raw: string): string {
  return raw.trim().replace(/^mailto:/i, "").replace(/^<|>$/g, "").trim().toLowerCase()
}

/** existing: lowercased emails already in recruits. */
export function parseRecruitCsv(text: string, existing: Set<string>): CsvPreview {
  const out: CsvPreview = { valid: [], invalid: [], duplicateInFile: [], alreadyExists: [], error: null }
  let records: string[][]
  try {
    records = parse(text.replace(/^﻿/, ""), {
      relax_column_count: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    }) as string[][]
  } catch (e) {
    out.error = `Could not read the CSV: ${e instanceof Error ? e.message : String(e)}`
    return out
  }
  if (records.length === 0) {
    out.error = "The file is empty."
    return out
  }
  const headers = records[0].map((h) => h.trim().toLowerCase())
  const find = (names: string[]) => headers.findIndex((h) => names.includes(h))
  const emailCol = find(EMAIL_HEADERS)
  const nameCol = find(NAME_HEADERS)
  const firstCol = find(FIRST_HEADERS)
  const lastCol = find(LAST_HEADERS)
  if (emailCol < 0) {
    out.error = 'No "email" column found. The first row must have headers like: name, email'
    return out
  }

  const seen = new Set<string>()
  records.slice(1).forEach((rec, i) => {
    const line = i + 2
    const email = normaliseEmail(rec[emailCol] ?? "")
    let name = nameCol >= 0 ? (rec[nameCol] ?? "").trim() : ""
    if (!name && (firstCol >= 0 || lastCol >= 0)) {
      name = [firstCol >= 0 ? rec[firstCol] : "", lastCol >= 0 ? rec[lastCol] : ""].map((s) => (s ?? "").trim()).filter(Boolean).join(" ")
    }
    name = name.replace(/\s+/g, " ").slice(0, 200)
    const row = { line, name, email }
    if (!email) return out.invalid.push({ ...row, reason: "Email missing" })
    if (!EMAIL_RE.test(email) || email.length > 254) return out.invalid.push({ ...row, reason: "Not a valid email" })
    if (seen.has(email)) return out.duplicateInFile.push(row)
    seen.add(email)
    if (existing.has(email)) return out.alreadyExists.push(row)
    out.valid.push(row)
  })
  return out
}
