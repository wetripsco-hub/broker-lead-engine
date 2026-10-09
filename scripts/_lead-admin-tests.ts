// Offline checks for admin edit/delete of a lead. No database, no server.
//   npx tsx scripts/_lead-admin-tests.ts
import { readFileSync } from "fs"
import { deleteLead, editLead, validateLeadEdit, type AuditRecord, type LeadAdminDeps, type LeadSnapshot } from "../lib/leads/admin-ops"
import { isAdminInDb } from "../lib/voice-agents/admin-check"

export {}
let failed = 0
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  — ${extra}` : ""}`)
  if (!ok) failed++
}

const good = { company_name: "Acme Freight LLC", contact_name: "Sam", email: "sam@acme.example", phone: "(214) 370-8737", mc_number: "123456", dot_number: "9825696", city: "Dallas", state: "TX", zip: "75201", address_line1: "1 Main St" }

async function main() {
  // ── validation ───────────────────────────────────────────────────────────
  const v = validateLeadEdit(good)
  check("validate: good input passes, phone stored in E.164", v.ok && v.patch.phone_e164 === "+12143708737" && v.patch.company_name === "Acme Freight LLC")
  check("validate: empty optional fields become null", (() => { const r = validateLeadEdit({ ...good, contact_name: "  ", email: "", city: "" }); return r.ok && r.patch.contact_name === null && r.patch.email === null && r.patch.city === null })())
  check("validate: company name is required", !validateLeadEdit({ ...good, company_name: "   " }).ok)
  check("validate: invalid phone rejected", (() => { const r = validateLeadEdit({ ...good, phone: "555-000-9911" }); return !r.ok && r.error === "Invalid phone number" })())
  check("validate: empty phone is allowed (clears it)", (() => { const r = validateLeadEdit({ ...good, phone: "" }); return r.ok && r.patch.phone === null && r.patch.phone_e164 === null })())
  check("validate: international phone ok", (() => { const r = validateLeadEdit({ ...good, phone: "+92 303 9397562" }); return r.ok && r.patch.phone_e164 === "+923039397562" })())
  check("validate: bad email rejected", !validateLeadEdit({ ...good, email: "not-an-email" }).ok)
  check("validate: needs an MC or a DOT", !validateLeadEdit({ ...good, mc_number: "", dot_number: "" }).ok && validateLeadEdit({ ...good, mc_number: "", dot_number: "99" }).ok)
  check("validate: MC with spaces or symbols rejected", !validateLeadEdit({ ...good, mc_number: "12 34;drop" }).ok && validateLeadEdit({ ...good, mc_number: "TEST-9911" }).ok)
  check("validate: over-long text rejected", !validateLeadEdit({ ...good, company_name: "x".repeat(201) }).ok)
  check("validate: non-text values rejected", !validateLeadEdit({ ...good, city: 5 as any }).ok)
  check("validate: a company starting with '=' is kept as plain text", (() => { const r = validateLeadEdit({ ...good, company_name: "=SUM(1)" }); return r.ok && r.patch.company_name === "=SUM(1)" })())

  // ── access + behaviour through the real functions with fake dependencies ─
  const snap: LeadSnapshot = {
    leadId: "L1", brokerId: "B1", stage: "contacted", assignedAgentId: "A1", eventCount: 7,
    broker: { company_name: "Old Name LLC", mc_number: "111", dot_number: "222", city: "Austin", phone: null },
  }
  const audits: AuditRecord[] = []
  const log: string[] = []
  const mk = (over: Partial<LeadAdminDeps> = {}): LeadAdminDeps => ({
    getUser: async () => ({ id: "u-admin", email: "admin@example.test" }),
    isAdmin: async () => true,
    loadLead: async (id) => { log.push("load"); return id === "L1" ? snap : null },
    updateBroker: async () => { log.push("update"); return { error: null } },
    deleteLeadRow: async () => { log.push("delete"); return { deleted: 1, error: null } },
    recordAudit: async (e) => { log.push("audit:" + e.action); audits.push(e); return true },
    ...over,
  })

  // signed out / agent
  let r = await editLead("L1", good, mk({ getUser: async () => null }))
  check("edit: signed out -> refused", !r.ok && r.error === "Not signed in")
  log.length = 0
  r = await editLead("L1", good, mk({ isAdmin: async () => false, getUser: async () => ({ id: "u-agent", email: "a@example.test" }) }))
  check("edit: agent -> refused, nothing read or written", !r.ok && /Only admins/.test(r.error) && log.length === 0)
  log.length = 0
  r = await deleteLead("L1", "DELETE", mk({ isAdmin: async () => false }))
  check("delete: agent -> refused, nothing read, audited or deleted", !r.ok && /Only admins/.test(r.error) && log.length === 0)
  const fakeAuth = (role: string) => ({ auth: { admin: { getUserById: async () => ({ data: { user: { user_metadata: { role } } }, error: null }) } } })
  r = await deleteLead("L1", "DELETE", mk({ isAdmin: (id) => isAdminInDb(fakeAuth("agent"), id) }))
  check("delete: role comes from the database lookup (token claiming admin is not enough)", !r.ok)

  // any admin
  audits.length = 0; log.length = 0
  r = await editLead("L1", { ...good, company_name: "New Name LLC", city: "Dallas" }, mk({ getUser: async () => ({ id: "u-admin-2", email: "second.admin@example.test" }), isAdmin: async (id) => id === "u-admin-2" }))
  check("edit: any admin (here a second one) can edit", r.ok)
  const a = audits[0]
  check("edit: audit records who + old -> new", a?.action === "edit" && a.userId === "u-admin-2" && (a.details.changes as any).company_name.from === "Old Name LLC" && (a.details.changes as any).company_name.to === "New Name LLC" && (a.details.changes as any).city.from === "Austin")
  audits.length = 0
  r = await editLead("L1", { ...good, company_name: "Old Name LLC", mc_number: "111", dot_number: "222", city: "Austin", phone: "" }, mk())
  check("edit: fields that did not change are not listed as changes", r.ok && Object.keys((audits[0].details as any).changes).filter((k) => ["company_name", "mc_number", "dot_number", "city", "phone"].includes(k)).length === 0)

  r = await editLead("NOPE", good, mk())
  check("edit: unknown lead -> not found", !r.ok && r.error === "Lead not found")
  r = await editLead("L1", { ...good, phone: "12345" }, mk())
  check("edit: invalid phone is refused before anything is written", !r.ok && r.error === "Invalid phone number")
  r = await editLead("L1", good, mk({ updateBroker: async () => ({ error: "dup", duplicate: true }) }))
  check("edit: MC/DOT already used -> friendly message", !r.ok && /already uses that MC or DOT/.test(r.error))
  r = await editLead("L1", good, mk({ recordAudit: async () => { throw new Error("audit down") } }))
  check("edit: the edit still succeeds if only the audit log write fails", r.ok)

  // delete
  audits.length = 0; log.length = 0
  r = await deleteLead("L1", "delete", mk())
  check("delete: must type DELETE exactly (lowercase refused)", !r.ok && /Type DELETE/.test(r.error) && !log.includes("delete"))
  r = await deleteLead("L1", undefined, mk())
  check("delete: missing confirmation refused", !r.ok)
  log.length = 0
  r = await deleteLead("L1", "DELETE", mk())
  check("delete: works for an admin", r.ok && /7 activity records/.test(r.message))
  check("delete: audit is written BEFORE the delete", log.join(",") === "load,audit:delete,delete")
  check("delete: audit keeps a snapshot and the number of events removed", audits[0]?.action === "delete" && audits[0].company === "Old Name LLC" && (audits[0].details as any).deleted_events === 7 && (audits[0].details as any).broker.mc_number === "111")
  log.length = 0
  r = await deleteLead("L1", "DELETE", mk({ recordAudit: async () => false }))
  check("delete: audit failure -> NOT deleted", !r.ok && !log.includes("delete") && /nothing was deleted/i.test(r.error))
  r = await deleteLead("L1", "DELETE", mk({ deleteLeadRow: async () => ({ deleted: 0, error: null }) }))
  check("delete: 0 rows removed (blocked by RLS / already gone) is reported, not 'success'", !r.ok && /Nothing was deleted/.test(r.error))
  r = await deleteLead("L1", "DELETE", mk({ deleteLeadRow: async () => ({ deleted: 0, error: "boom" }) }))
  check("delete: database error is reported", !r.ok && /Delete failed/.test(r.error))
  r = await deleteLead("NOPE", "DELETE", mk())
  check("delete: unknown lead -> not found, nothing audited", !r.ok && r.error === "Lead not found")

  // ── wiring ───────────────────────────────────────────────────────────────
  const page = readFileSync("app/(dashboard)/leads/[id]/page.tsx", "utf8")
  check("UI: Edit/Delete only rendered for admins on the lead page", /\{isAdmin && b && \(\s*<LeadAdminActions/.test(page))
  const actions = readFileSync("app/(dashboard)/leads/admin-actions.ts", "utf8")
  check("server actions: role is read from the database", /isAdminInDb\(createAdminClient\(\)/.test(actions))
  check("server actions: data goes through the user's session, service role only for the role lookup", (actions.match(/createAdminClient\(\)/g) ?? []).length === 1)

  console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) FAILED.`)
  process.exit(failed === 0 ? 0 : 1)
}
main()
