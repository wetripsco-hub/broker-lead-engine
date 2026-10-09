import ExcelJS from "exceljs"
import type { SupabaseClient } from "@supabase/supabase-js"
import { DISPOSITION_LABEL } from "@/lib/call-dispositions"
import { evaluateFollowUp, type FollowUpRow } from "@/lib/follow-up/compute"
import { FOLLOW_UP_DAYS } from "@/lib/follow-up/config"
import { formatPhoneDisplay, toE164 } from "@/lib/phone"

type Db = SupabaseClient<any, any, any>

// ── Raw shapes read from the database ──────────────────────────────────────
export interface RawLead {
  id: string
  stage: string
  notes: string | null
  created_at: string
  ai_call_consent: boolean | null
  follow_up_snoozed_until: string | null
  brokers: {
    id: string
    mc_number: string | null
    dot_number: string | null
    mc_status: string | null
    authority_type: string | null
    company_name: string | null
    registration_date: string | null
    address_line1: string | null
    city: string | null
    state: string | null
    zip: string | null
    phone: string | null
    phone_e164: string | null
    email: string | null
  } | null
  agents: { name: string } | null
}

export interface RawEvent {
  lead_id: string
  channel: string
  direction: string
  status: string
  occurred_at: string
  open_count: number | null
  click_count: number | null
  message_body: string | null
  disposition: string | null
}

export interface RawOfficial {
  broker_id: string
  official_name: string
}

// ── One spreadsheet row ────────────────────────────────────────────────────
export interface ExportRow {
  company: string
  mc: string
  dot: string
  mcStatus: string
  authorityType: string
  stage: string
  agent: string
  dateAdded: string
  registrationDate: string
  address: string
  city: string
  state: string
  phoneDisplay: string
  phoneE164: string
  email: string
  officers: string
  emailStatus: string
  lastEmailDate: string
  replied: string
  followUpDue: string
  followUpDate: string
  totalCalls: number
  lastCallDate: string
  lastCallDisposition: string
  totalSms: number
  aiConsent: string
  notes: string
}

type ColumnKind = "text" | "date" | "number"

interface ColumnDef {
  header: string
  key: keyof ExportRow
  kind: ColumnKind
  width: number
}

// MC, DOT and phones are "text" so Excel never turns +1214… or 0012345 into a number.
export const EXPORT_COLUMNS: ColumnDef[] = [
  { header: "Company", key: "company", kind: "text", width: 34 },
  { header: "MC Number", key: "mc", kind: "text", width: 14 },
  { header: "DOT Number", key: "dot", kind: "text", width: 14 },
  { header: "MC Status", key: "mcStatus", kind: "text", width: 12 },
  { header: "Authority Type", key: "authorityType", kind: "text", width: 24 },
  { header: "Stage", key: "stage", kind: "text", width: 12 },
  { header: "Assigned Agent", key: "agent", kind: "text", width: 20 },
  { header: "Date Added", key: "dateAdded", kind: "date", width: 12 },
  { header: "Registration Date", key: "registrationDate", kind: "date", width: 16 },
  { header: "Address", key: "address", kind: "text", width: 36 },
  { header: "City", key: "city", kind: "text", width: 16 },
  { header: "State", key: "state", kind: "text", width: 8 },
  { header: "Phone (display)", key: "phoneDisplay", kind: "text", width: 20 },
  { header: "Phone (E.164)", key: "phoneE164", kind: "text", width: 16 },
  { header: "Email", key: "email", kind: "text", width: 32 },
  { header: "Officer Name(s)", key: "officers", kind: "text", width: 30 },
  { header: "Email Status", key: "emailStatus", kind: "text", width: 14 },
  { header: "Last Email Date", key: "lastEmailDate", kind: "date", width: 14 },
  { header: "Replied", key: "replied", kind: "text", width: 9 },
  { header: "Follow-up Due", key: "followUpDue", kind: "text", width: 13 },
  { header: "Follow-up Date", key: "followUpDate", kind: "date", width: 14 },
  { header: "Total Calls", key: "totalCalls", kind: "number", width: 11 },
  { header: "Last Call Date", key: "lastCallDate", kind: "date", width: 14 },
  { header: "Last Call Disposition", key: "lastCallDisposition", kind: "text", width: 26 },
  { header: "Total SMS", key: "totalSms", kind: "number", width: 10 },
  { header: "AI Call Consent", key: "aiConsent", kind: "text", width: 14 },
  { header: "Notes", key: "notes", kind: "text", width: 50 },
]

// ── Helpers ────────────────────────────────────────────────────────────────
const PAGE = 1000
const CHUNK = 100 // ids per `.in()` filter, keeps the request URL short

/** Reads every row of a query, 1000 at a time, past Supabase's default row limit. */
export async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = data ?? []
    out.push(...rows)
    if (rows.length < PAGE) return out
  }
}

const chunks = <T,>(xs: T[], n = CHUNK): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

/** "2026-10-08T15:22:31+00:00" -> "2026-10-08" (the UTC calendar date). */
const ymd = (iso: string | null | undefined): string => (iso ? String(iso).slice(0, 10) : "")

const addDays = (day: string, n: number): string => {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const AUTHORITY_LABEL: Record<string, string> = {
  property: "Broker of Property",
  household_goods: "Broker of Household Goods",
}

const STAGE_LABEL: Record<string, string> = {
  new: "New", contacted: "Contacted", interested: "Interested", converted: "Converted", dead: "Dead",
}

function emailStatusOf(e: RawEvent): string {
  if ((e.click_count ?? 0) > 0 || e.status === "clicked") return "Clicked"
  if ((e.open_count ?? 0) > 0 || e.status === "opened") return "Opened"
  if (e.status === "delivered") return "Delivered"
  if (e.status === "sent") return "Sent"
  if (e.status === "failed") return "Failed"
  return "Pending"
}

function dispositionOf(e: RawEvent): string {
  if (e.channel === "ai_call") {
    const d = e.disposition
    if (!d) return ""
    if (d === "do_not_call") return "Do not call"
    return (DISPOSITION_LABEL as Record<string, string>)[d] ?? d
  }
  const m = e.message_body?.match(/Disposition:\s*([^\n]+)/)
  return m ? m[1].trim() : ""
}

const yesNo = (b: boolean) => (b ? "Yes" : "No")

/** Turns raw database rows into spreadsheet rows. Pure: no database access. */
export function assembleRows(
  leads: RawLead[],
  officials: RawOfficial[],
  events: RawEvent[],
  followUps: FollowUpRow[],
  now: Date,
): ExportRow[] {
  const officersByBroker = new Map<string, string[]>()
  for (const o of officials) {
    const list = officersByBroker.get(o.broker_id) ?? []
    list.push(o.official_name)
    officersByBroker.set(o.broker_id, list)
  }
  const eventsByLead = new Map<string, RawEvent[]>()
  for (const e of events) {
    const list = eventsByLead.get(e.lead_id) ?? []
    list.push(e)
    eventsByLead.set(e.lead_id, list)
  }
  const followByLead = new Map(followUps.map((f) => [f.lead_id, f]))

  return leads.map((l): ExportRow => {
    const b = l.brokers
    const evs = [...(eventsByLead.get(l.id) ?? [])].sort((x, y) => y.occurred_at.localeCompare(x.occurred_at)) // newest first

    const emailsOut = evs.filter((e) => e.channel === "email" && e.direction === "outbound")
    const latestEmail = emailsOut[0]
    const sentEmails = emailsOut.filter((e) => e.status !== "failed" && e.status !== "pending")
    const calls = evs.filter((e) => e.channel === "call" || e.channel === "ai_call")
    const lastCall = calls[0]

    // Follow-up state comes from the same view + rules the Leads page uses.
    const fu = followByLead.get(l.id)
    const info = fu ? evaluateFollowUp(fu, now) : null
    const lastEmailIso = info?.lastEmailAt ?? sentEmails[0]?.occurred_at ?? null
    const open = !!lastEmailIso && !info?.replied && l.stage !== "converted" && l.stage !== "dead"
    const snoozed = l.follow_up_snoozed_until && new Date(l.follow_up_snoozed_until) > now
    const followUpDate = snoozed && open ? ymd(l.follow_up_snoozed_until) : open ? addDays(ymd(lastEmailIso), FOLLOW_UP_DAYS) : ""

    const addr = [b?.address_line1, b?.zip].filter(Boolean).join(", ")
    return {
      company: b?.company_name ?? "",
      mc: b?.mc_number ?? "",
      dot: b?.dot_number ?? "",
      mcStatus: b?.mc_status ?? "",
      authorityType: b?.authority_type ? (AUTHORITY_LABEL[b.authority_type] ?? b.authority_type) : "",
      stage: STAGE_LABEL[l.stage] ?? l.stage,
      agent: l.agents?.name ?? "",
      dateAdded: ymd(l.created_at),
      registrationDate: ymd(b?.registration_date),
      address: addr,
      city: b?.city ?? "",
      state: b?.state ?? "",
      phoneDisplay: b?.phone ? formatPhoneDisplay(b.phone) : "",
      phoneE164: b?.phone_e164 ?? toE164(b?.phone) ?? "",
      email: b?.email ?? "",
      officers: (b ? (officersByBroker.get(b.id) ?? []) : []).join("; "),
      emailStatus: latestEmail ? emailStatusOf(latestEmail) : "",
      lastEmailDate: ymd(lastEmailIso),
      replied: lastEmailIso ? yesNo(!!info?.replied) : "",
      followUpDue: lastEmailIso ? yesNo(!!info?.due) : "",
      followUpDate,
      totalCalls: calls.length,
      lastCallDate: ymd(lastCall?.occurred_at),
      lastCallDisposition: lastCall ? dispositionOf(lastCall) : "",
      totalSms: evs.filter((e) => e.channel === "sms").length,
      aiConsent: yesNo(!!l.ai_call_consent),
      notes: l.notes ?? "",
    }
  })
}

// ── Reading from the database (with the caller's own session, so RLS applies) ──
const LEAD_COLUMNS = `id, stage, notes, created_at, ai_call_consent, follow_up_snoozed_until,
  brokers ( id, mc_number, dot_number, mc_status, authority_type, company_name, registration_date,
            address_line1, city, state, zip, phone, phone_e164, email ),
  agents ( name )`

/**
 * `ids === null` exports every lead the caller can see. Otherwise only those ids
 * (anything the caller can't see is silently absent, exactly as on screen).
 */
export async function fetchExportRows(supabase: Db, ids: string[] | null, now = new Date()): Promise<ExportRow[]> {
  let leads: RawLead[] = []
  if (ids === null) {
    leads = await fetchAllPages<RawLead>((from, to) =>
      supabase.from("leads").select(LEAD_COLUMNS).order("created_at", { ascending: false }).order("id").range(from, to) as any,
    )
  } else {
    for (const part of chunks([...new Set(ids)])) {
      leads.push(
        ...(await fetchAllPages<RawLead>((from, to) =>
          supabase.from("leads").select(LEAD_COLUMNS).in("id", part).order("created_at", { ascending: false }).order("id").range(from, to) as any,
        )),
      )
    }
    leads.sort((a, b) => b.created_at.localeCompare(a.created_at))
  }
  if (leads.length === 0) return []

  const leadIds = leads.map((l) => l.id)
  const brokerIds = [...new Set(leads.map((l) => l.brokers?.id).filter((x): x is string => !!x))]

  const officials: RawOfficial[] = []
  for (const part of chunks(brokerIds)) {
    officials.push(
      ...(await fetchAllPages<RawOfficial>((from, to) =>
        supabase.from("broker_officials").select("broker_id, official_name").in("broker_id", part).order("created_at").order("id").range(from, to) as any,
      )),
    )
  }

  const events: RawEvent[] = []
  const followUps: FollowUpRow[] = []
  for (const part of chunks(leadIds)) {
    events.push(
      ...(await fetchAllPages<RawEvent>((from, to) =>
        supabase
          .from("outreach_events")
          .select("lead_id, channel, direction, status, occurred_at, open_count, click_count, message_body, disposition")
          .in("lead_id", part)
          .order("occurred_at")
          .order("id")
          .range(from, to) as any,
      )),
    )
    followUps.push(
      ...(await fetchAllPages<FollowUpRow>((from, to) =>
        supabase
          .from("leads_with_followup")
          .select("lead_id, stage, follow_up_snoozed_until, last_outbound_email_at, last_inbound_email_at, replied, follow_up_count")
          .in("lead_id", part)
          .order("lead_id")
          .range(from, to) as any,
      )),
    )
  }
  return assembleRows(leads, officials, events, followUps, now)
}

// ── The workbook ───────────────────────────────────────────────────────────
export function buildLeadsWorkbook(rows: ExportRow[]): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  wb.creator = "Broker Lead Engine"
  wb.created = new Date()
  const ws = wb.addWorksheet("Leads", { views: [{ state: "frozen", ySplit: 1 }] })

  ws.columns = EXPORT_COLUMNS.map((c) => ({ header: c.header, key: c.key as string, width: c.width }))
  const header = ws.getRow(1)
  header.font = { bold: true }
  header.alignment = { vertical: "middle" }
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EAEE" } }

  rows.forEach((r, i) => {
    const row = ws.getRow(i + 2)
    EXPORT_COLUMNS.forEach((c, ci) => {
      const cell = row.getCell(ci + 1)
      const v = r[c.key]
      if (c.kind === "number") {
        cell.value = typeof v === "number" ? v : 0
      } else if (c.kind === "date") {
        if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
          cell.value = new Date(`${v}T00:00:00Z`)
          cell.numFmt = "yyyy-mm-dd"
        }
        // no date: leave the cell empty
      } else if (typeof v === "string" && v !== "") {
        // A plain string value is stored as text, never parsed as a formula, so a
        // company called "=SUM(A1)" or "+1 Logistics" stays exactly that text.
        // The "@" (Text) format also stops Excel re-reading MC/DOT/phone as numbers.
        cell.value = v
        cell.numFmt = "@"
      }
    })
    row.commit()
  })

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: EXPORT_COLUMNS.length } }
  return wb
}

export async function workbookToBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await wb.xlsx.writeBuffer())
}

export type ExportMode = "all" | "filtered" | "selected"

export function exportFileName(mode: ExportMode, now: Date): string {
  const day = now.toISOString().slice(0, 10)
  return mode === "all" ? `leads-${day}.xlsx` : `leads-${mode}-${day}.xlsx`
}
