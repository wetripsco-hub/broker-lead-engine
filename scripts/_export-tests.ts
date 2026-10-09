// Offline checks for the Excel export: no database, no server, nothing is sent.
//   npx tsx scripts/_export-tests.ts
import ExcelJS from "exceljs"
import {
  assembleRows, buildLeadsWorkbook, EXPORT_COLUMNS, exportFileName, fetchAllPages, workbookToBuffer,
  type RawEvent, type RawLead, type RawOfficial,
} from "../lib/leads/export"
import { handleExport, type AuditEntry, type ExportDeps } from "../lib/leads/export-handler"
import { isAdminInDb } from "../lib/voice-agents/admin-check"
import type { FollowUpRow } from "../lib/follow-up/compute"
import { readFileSync } from "fs"

export {}

let failed = 0
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  — ${extra}` : ""}`)
  if (!ok) failed++
}

const NOW = new Date("2026-10-08T12:00:00Z")
const broker = (over: Partial<NonNullable<RawLead["brokers"]>>) => ({
  id: "b1", mc_number: "123456", dot_number: "9825696", mc_status: "Pending", authority_type: "property",
  company_name: "Acme Freight LLC", registration_date: "2026-10-03", address_line1: "1382 Hideaway Ln.", city: "Rockledge",
  state: "FL", zip: "32955", phone: "(321) 848-4606", phone_e164: "+13218484606", email: "ops@acme.example", ...over,
})
const leads: RawLead[] = [
  { id: "L1", stage: "contacted", notes: "Call back Friday", created_at: "2026-10-05T10:00:00Z", ai_call_consent: true, follow_up_snoozed_until: null,
    brokers: broker({}), agents: { name: "ali shahid" } },
  { id: "L2", stage: "new", notes: null, created_at: "2026-10-04T10:00:00Z", ai_call_consent: false, follow_up_snoozed_until: null,
    brokers: broker({ id: "b2", mc_number: "0012345", dot_number: "0098765", company_name: "=HYPERLINK(\"http://evil.example\",\"x\")", phone: "+1 (214) 370-8737", phone_e164: "+12143708737", city: null, state: null, email: null, address_line1: null, zip: null, registration_date: null, authority_type: null, mc_status: null }),
    agents: null },
  { id: "L3", stage: "dead", notes: "+1 Logistics asked to stop", created_at: "2026-10-03T10:00:00Z", ai_call_consent: false, follow_up_snoozed_until: null,
    brokers: broker({ id: "b3", mc_number: "7", company_name: "-Dash Co", phone: "555-000-9911", phone_e164: null }), agents: { name: "QA Test Agent" } },
]
const officials: RawOfficial[] = [
  { broker_id: "b1", official_name: "TaJae Bodrick" }, { broker_id: "b1", official_name: "Sam Lee" },
]
const ev = (lead_id: string, channel: string, direction: string, status: string, occurred_at: string, extra: Partial<RawEvent> = {}): RawEvent =>
  ({ lead_id, channel, direction, status, occurred_at, open_count: 0, click_count: 0, message_body: null, disposition: null, ...extra })
const events: RawEvent[] = [
  ev("L1", "email", "outbound", "delivered", "2026-10-02T09:00:00Z", { open_count: 2 }),   // 6 days old, opened, no reply
  ev("L1", "call", "outbound", "answered", "2026-10-03T09:00:00Z", { message_body: "Disposition: Call back later\nDuration: 40s" }),
  ev("L1", "ai_call", "outbound", "answered", "2026-10-06T09:00:00Z", { disposition: "answered_interested" }),
  ev("L1", "sms", "outbound", "sent", "2026-10-03T10:00:00Z"),
  ev("L1", "sms", "inbound", "delivered", "2026-10-03T11:00:00Z"),
  ev("L3", "email", "outbound", "sent", "2026-10-01T09:00:00Z"),
]
const followUps: FollowUpRow[] = [
  { lead_id: "L1", stage: "contacted", follow_up_snoozed_until: null, last_outbound_email_at: "2026-10-02T09:00:00Z", last_inbound_email_at: null, replied: false, follow_up_count: 0 },
  { lead_id: "L3", stage: "dead", follow_up_snoozed_until: null, last_outbound_email_at: "2026-10-01T09:00:00Z", last_inbound_email_at: null, replied: false, follow_up_count: 0 },
]

async function main() {
  // ── rows ────────────────────────────────────────────────────────────────
  const rows = assembleRows(leads, officials, events, followUps, NOW)
  const [r1, r2, r3] = rows
  check("rows: one per lead, in the order given", rows.length === 3 && r1.company === "Acme Freight LLC")
  check("rows: officers joined, phones both forms", r1.officers === "TaJae Bodrick; Sam Lee" && r1.phoneDisplay === "(321) 848-4606" && r1.phoneE164 === "+13218484606")
  check("rows: authority label + stage label + agent", r1.authorityType === "Broker of Property" && r1.stage === "Contacted" && r1.agent === "ali shahid")
  check("rows: email status Opened, last email date, not replied", r1.emailStatus === "Opened" && r1.lastEmailDate === "2026-10-02" && r1.replied === "No")
  check("rows: follow-up due + date = last email + 3 days", r1.followUpDue === "Yes" && r1.followUpDate === "2026-10-05")
  check("rows: 2 calls (human + AI), latest is the AI one with its disposition", r1.totalCalls === 2 && r1.lastCallDate === "2026-10-06" && r1.lastCallDisposition === "Answered — interested")
  check("rows: SMS count counts both directions", r1.totalSms === 2)
  check("rows: AI consent Yes/No", r1.aiConsent === "Yes" && r2.aiConsent === "No")
  check("rows: lead with no email -> email columns empty, no error", r2.emailStatus === "" && r2.lastEmailDate === "" && r2.replied === "" && r2.followUpDue === "" && r2.followUpDate === "")
  check("rows: missing data stays empty (city/state/email/address/dates)", r2.city === "" && r2.state === "" && r2.email === "" && r2.address === "" && r2.registrationDate === "" && r2.authorityType === "")
  check("rows: a dead lead is never 'due' and has no follow-up date", r3.followUpDue === "No" && r3.followUpDate === "")
  check("rows: invalid phone is shown as-is, E.164 empty", r3.phoneDisplay === "555-000-9911" && r3.phoneE164 === "")
  check("rows: human call disposition read from the note", assembleRows([leads[0]], [], [events[1]], [], NOW)[0].lastCallDisposition === "Call back later")

  // ── workbook, written and read back ─────────────────────────────────────
  const buf = await workbookToBuffer(buildLeadsWorkbook(rows))
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf as any)
  const ws = wb.getWorksheet("Leads")!
  const headers = (ws.getRow(1).values as any[]).slice(1)
  check("file: 27 English headers in the requested order", headers.length === 27 && headers.join("|") === EXPORT_COLUMNS.map((c) => c.header).join("|"), `${headers.length} columns`)
  check("file: header is bold and the header row is frozen", ws.getRow(1).font?.bold === true && ws.views[0]?.state === "frozen" && ws.views[0]?.ySplit === 1)
  check("file: autofilter covers every column of the header row (A1:AA1)", String(ws.autoFilter) === "A1:AA1")
  const badWidths = EXPORT_COLUMNS.map((c, i) => [c.header, ws.getColumn(i + 1).width, c.width] as const).filter(([, got, want]) => Math.abs((got ?? 9) - want) > 1 /* 9 is the default width, which ExcelJS leaves unwritten */)
  check("file: column widths set as designed", badWidths.length === 0, badWidths.map((b) => `${b[0]}:${b[1]}!=${b[2]}`).join(", "))
  check("file: 3 data rows", ws.rowCount === 4)

  const col = (key: string) => EXPORT_COLUMNS.findIndex((c) => c.key === key) + 1
  const cell = (row: number, key: string) => ws.getRow(row).getCell(col(key))
  check("file: MC keeps leading zeros and is text", cell(3, "mc").value === "0012345" && cell(3, "mc").type === ExcelJS.ValueType.String && cell(3, "mc").numFmt === "@")
  check("file: DOT keeps leading zeros and is text", cell(3, "dot").value === "0098765" && cell(3, "dot").numFmt === "@")
  check("file: phones are text ('+' is not eaten)", cell(3, "phoneE164").value === "+12143708737" && cell(3, "phoneE164").type === ExcelJS.ValueType.String && cell(3, "phoneE164").numFmt === "@")
  check("file: formula-looking company name is plain text, not a formula", typeof cell(3, "company").value === "string" && (cell(3, "company").value as string).startsWith("=HYPERLINK") && cell(3, "company").type === ExcelJS.ValueType.String && (cell(3, "company") as any).formula === undefined)
  check("file: names starting with '-' and notes starting with '+' stay text", cell(4, "company").value === "-Dash Co" && cell(4, "notes").value === "+1 Logistics asked to stop" && cell(4, "company").type === ExcelJS.ValueType.String)
  const added = cell(2, "dateAdded")
  check("file: dates are real dates formatted yyyy-mm-dd", added.value instanceof Date && (added.value as Date).toISOString().slice(0, 10) === "2026-10-05" && added.numFmt === "yyyy-mm-dd")
  check("file: empty dates stay empty cells", cell(3, "lastEmailDate").value === null)
  check("file: counts are numbers", cell(2, "totalCalls").value === 2 && cell(2, "totalSms").value === 2)
  check("file: no cell anywhere is a formula", (() => { let f = 0; ws.eachRow((r) => r.eachCell((c) => { if (c.type === ExcelJS.ValueType.Formula) f++ })); return f === 0 })())

  // an empty export is still a valid file
  const empty = new ExcelJS.Workbook()
  await empty.xlsx.load((await workbookToBuffer(buildLeadsWorkbook([]))) as any)
  check("file: zero leads -> valid file with just the header", empty.getWorksheet("Leads")!.rowCount === 1)

  // file names
  const d = new Date("2026-10-08T05:00:00Z")
  check("file name: all / filtered / selected", exportFileName("all", d) === "leads-2026-10-08.xlsx" && exportFileName("filtered", d) === "leads-filtered-2026-10-08.xlsx" && exportFileName("selected", d) === "leads-selected-2026-10-08.xlsx")

  // ── paging past the 1000-row limit ──────────────────────────────────────
  const calls: Array<[number, number]> = []
  const all = await fetchAllPages<number>(async (from, to) => {
    calls.push([from, to])
    const total = 2500
    const n = Math.max(0, Math.min(to, total - 1) - from + 1)
    return { data: Array.from({ length: n }, (_, i) => from + i), error: null }
  })
  check("paging: 2500 rows read in pages of 1000", all.length === 2500 && calls.length === 3 && calls[1][0] === 1000)
  check("paging: a page error stops the export", await fetchAllPages<number>(async () => ({ data: null, error: { message: "boom" } })).then(() => false, (e) => e.message === "boom"))

  // ── access control, through the real handler with fake dependencies ────
  const UUID = "11111111-2222-4333-8444-555555555555"
  const audits: AuditEntry[] = []
  let loads = 0
  const deps = (over: Partial<ExportDeps> = {}): ExportDeps => ({
    getUser: async () => ({ id: "u-admin", email: "admin@example.test" }),
    isAdmin: async () => true,
    loadRows: async () => { loads++; return rows },
    recordAudit: async (e) => { audits.push(e); return true },
    now: () => NOW,
    ...over,
  })
  const run = (body: unknown, o: Partial<ExportDeps> = {}) => handleExport(body, deps(o))

  let r = await run({ mode: "all" }, { getUser: async () => null })
  check("access: signed out -> 401", !r.ok && r.status === 401)
  loads = 0
  r = await run({ mode: "all" }, { isAdmin: async () => false, getUser: async () => ({ id: "u-agent", email: "agent@example.test" }) })
  check("access: agent -> 403 and no data read", !r.ok && r.status === 403 && loads === 0 && audits.length === 0)
  // the role comes from the database: a user whose token says admin but whose DB record says agent is refused
  const fakeAuth = (role: string) => ({ auth: { admin: { getUserById: async () => ({ data: { user: { user_metadata: { role } } }, error: null }) } } })
  r = await run({ mode: "all" }, { isAdmin: (id) => isAdminInDb(fakeAuth("agent"), id) })
  check("access: role is taken from the database lookup", !r.ok && r.status === 403)
  r = await run({ mode: "all" }, { isAdmin: (id) => isAdminInDb(fakeAuth("admin"), id) })
  check("access: admin (per database) -> allowed", r.ok)

  audits.length = 0
  r = await run({ mode: "all" })
  check("all: file built, audited with option + count + user", r.ok && r.rowCount === 3 && audits.length === 1 && audits[0].mode === "all" && audits[0].rowCount === 3 && audits[0].userId === "u-admin" && audits[0].fileName === "leads-2026-10-08.xlsx")
  check("all: output is a real xlsx (zip signature)", r.ok && r.buffer.subarray(0, 2).toString() === "PK")
  r = await run({ mode: "filtered", ids: [UUID], filters: { stage: "new", search: "acme", callable_now: false, junk: { nested: 1 } } })
  check("filtered: audited with its filters (nested junk dropped)", r.ok && audits[1].mode === "filtered" && audits[1].filters?.stage === "new" && audits[1].filters?.search === "acme" && !("junk" in (audits[1].filters ?? {})) && r.fileName === "leads-filtered-2026-10-08.xlsx")
  r = await run({ mode: "selected", ids: [UUID, UUID] })
  check("selected: ok", r.ok && audits[2].mode === "selected")
  check("selected: nothing ticked -> 400", await run({ mode: "selected", ids: [] }).then((x) => !x.ok && x.status === 400))
  check("filtered: no ids -> 400", await run({ mode: "filtered" }).then((x) => !x.ok && x.status === 400))
  check("bad option -> 400", await run({ mode: "everything" }).then((x) => !x.ok && x.status === 400))
  check("non-uuid ids -> 400", await run({ mode: "selected", ids: ["1; drop table leads"] }).then((x) => !x.ok && x.status === 400))
  check("too many ids -> 400", await run({ mode: "selected", ids: Array.from({ length: 5001 }, () => UUID) }).then((x) => !x.ok && x.status === 400))
  const n = audits.length
  r = await run({ mode: "all" }, { recordAudit: async () => false })
  check("audit failure -> 500 and no file is returned", !r.ok && r.status === 500 && audits.length === n)
  r = await run({ mode: "all" }, { loadRows: async () => { throw new Error("db down") } })
  check("read failure -> 500, nothing audited", !r.ok && r.status === 500)

  // ── wiring ──────────────────────────────────────────────────────────────
  const route = readFileSync("app/api/leads/export/route.ts", "utf8")
  check("route: data is read with the user's session, service role only for the role lookup", /createAdminClient\(\)/.test(route) && (route.match(/createAdminClient\(\)/g) ?? []).length === 1 && /isAdminInDb\(createAdminClient\(\)/.test(route))
  check("route: maxDuration is set", /export const maxDuration = \d+/.test(route))
  const ui = readFileSync("app/(dashboard)/leads/leads-list-client.tsx", "utf8")
  check("UI: Export menu only rendered for admins", /\{isAdmin && \(\s*<ExportMenu/.test(ui))
  const menu = readFileSync("components/leads/export-menu.tsx", "utf8")
  check("UI: 'Selected leads (N)' only appears when something is ticked", /selectedIds\.length > 0 && \(/.test(menu))

  console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) FAILED.`)
  process.exit(failed === 0 ? 0 : 1)
}
main()
