import { toE164 } from "@/lib/phone"

// Admin-only edit and delete of a lead. Same shape as the export handler: every
// outside dependency is injected, so the rules can be tested without a server.

export interface LeadEditInput {
  company_name?: unknown
  contact_name?: unknown
  email?: unknown
  phone?: unknown
  address_line1?: unknown
  city?: unknown
  state?: unknown
  zip?: unknown
  mc_number?: unknown
  dot_number?: unknown
}

/** What gets written to the broker row. null clears a field. */
export interface BrokerPatch {
  company_name: string
  contact_name: string | null
  email: string | null
  phone: string | null
  phone_e164: string | null
  address_line1: string | null
  city: string | null
  state: string | null
  zip: string | null
  mc_number: string | null
  dot_number: string | null
}

const text = (v: unknown, max: number): string | null | undefined => {
  if (v === undefined) return undefined
  const s = typeof v === "string" ? v.trim() : ""
  return s.length > max ? undefined : s || null
}
const tooLong = (v: unknown, max: number) => typeof v === "string" && v.trim().length > max

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const IDENT = /^[A-Za-z0-9][A-Za-z0-9-]{0,19}$/ // MC / DOT: digits, or things like TEST-9911

/** Checks and cleans an edit. Returns the patch to write, or what's wrong. */
export function validateLeadEdit(input: LeadEditInput): { ok: true; patch: BrokerPatch } | { ok: false; error: string } {
  const fields: Array<[keyof LeadEditInput, string, number]> = [
    ["company_name", "Company name", 200], ["contact_name", "Contact name", 120], ["email", "Email", 200],
    ["phone", "Phone", 60], ["address_line1", "Address", 200], ["city", "City", 80],
    ["state", "State", 30], ["zip", "ZIP", 12], ["mc_number", "MC number", 20], ["dot_number", "DOT number", 20],
  ]
  for (const [k, label, max] of fields) {
    if (input[k] !== undefined && typeof input[k] !== "string") return { ok: false, error: `${label} must be text` }
    if (tooLong(input[k], max)) return { ok: false, error: `${label} is too long (max ${max} characters)` }
  }

  const company = text(input.company_name, 200)
  if (!company) return { ok: false, error: "Company name is required" }

  const email = text(input.email, 200) ?? null
  if (email && !EMAIL.test(email)) return { ok: false, error: "That email address doesn't look valid" }

  const phoneRaw = text(input.phone, 60) ?? null
  let phone_e164: string | null = null
  if (phoneRaw) {
    phone_e164 = toE164(phoneRaw)
    if (!phone_e164) return { ok: false, error: "Invalid phone number" }
  }

  const mc = text(input.mc_number, 20) ?? null
  const dot = text(input.dot_number, 20) ?? null
  if (mc && !IDENT.test(mc)) return { ok: false, error: "MC number can only contain letters, digits and hyphens" }
  if (dot && !IDENT.test(dot)) return { ok: false, error: "DOT number can only contain letters, digits and hyphens" }
  if (!mc && !dot) return { ok: false, error: "A lead needs an MC number or a DOT number" }

  return {
    ok: true,
    patch: {
      company_name: company,
      contact_name: text(input.contact_name, 120) ?? null,
      email,
      phone: phoneRaw,
      phone_e164,
      address_line1: text(input.address_line1, 200) ?? null,
      city: text(input.city, 80) ?? null,
      state: text(input.state, 30) ?? null,
      zip: text(input.zip, 12) ?? null,
      mc_number: mc,
      dot_number: dot,
    },
  }
}

export interface LeadSnapshot {
  leadId: string
  brokerId: string
  stage: string
  assignedAgentId: string | null
  broker: Record<string, unknown>
  eventCount: number
}

export interface AuditRecord {
  userId: string
  userEmail: string | null
  action: "edit" | "delete"
  leadId: string
  company: string | null
  mcNumber: string | null
  details: Record<string, unknown>
}

export interface LeadAdminDeps {
  getUser(): Promise<{ id: string; email: string | null } | null>
  /** Must come from the database, never from anything the client sent. */
  isAdmin(userId: string): Promise<boolean>
  /** Read through the caller's session; null if the lead isn't visible to them. */
  loadLead(leadId: string): Promise<LeadSnapshot | null>
  /** Returns an error message, or null on success. A "duplicate" error means MC/DOT is taken. */
  updateBroker(brokerId: string, patch: BrokerPatch): Promise<{ error: string | null; duplicate?: boolean }>
  /** Returns how many rows were actually deleted (row-level security can make it 0). */
  deleteLeadRow(leadId: string): Promise<{ deleted: number; error: string | null }>
  recordAudit(entry: AuditRecord): Promise<boolean>
}

export type OpResult = { ok: true; message: string } | { ok: false; error: string }
const fail = (error: string): OpResult => ({ ok: false, error })

async function authorise(deps: LeadAdminDeps): Promise<{ user: { id: string; email: string | null } } | OpResult> {
  const user = await deps.getUser()
  if (!user) return fail("Not signed in")
  if (!(await deps.isAdmin(user.id))) return fail("Only admins can edit or delete leads")
  return { user }
}

const strField = (o: Record<string, unknown>, k: string) => (typeof o[k] === "string" ? (o[k] as string) : null)

export async function editLead(leadId: string, input: LeadEditInput, deps: LeadAdminDeps): Promise<OpResult> {
  const auth = await authorise(deps)
  if ("ok" in auth) return auth

  const checked = validateLeadEdit(input)
  if (!checked.ok) return fail(checked.error)

  const lead = await deps.loadLead(leadId)
  if (!lead) return fail("Lead not found")

  const res = await deps.updateBroker(lead.brokerId, checked.patch)
  if (res.duplicate) return fail("Another broker already uses that MC or DOT number")
  if (res.error) return fail(res.error)

  // What actually changed, old -> new (best effort: the edit itself already succeeded).
  const changes: Record<string, { from: unknown; to: unknown }> = {}
  for (const [k, to] of Object.entries(checked.patch)) {
    const from = lead.broker[k] ?? null
    if (from !== to) changes[k] = { from, to }
  }
  await deps.recordAudit({
    userId: auth.user.id, userEmail: auth.user.email, action: "edit", leadId,
    company: checked.patch.company_name, mcNumber: checked.patch.mc_number, details: { changes },
  }).catch(() => false)
  return { ok: true, message: "Lead updated" }
}

export async function deleteLead(leadId: string, confirmation: unknown, deps: LeadAdminDeps): Promise<OpResult> {
  const auth = await authorise(deps)
  if ("ok" in auth) return auth

  if (confirmation !== "DELETE") return fail('Type DELETE to confirm')

  const lead = await deps.loadLead(leadId)
  if (!lead) return fail("Lead not found")

  // No record, no deletion: the audit row (with a full snapshot) is written first.
  const recorded = await deps.recordAudit({
    userId: auth.user.id, userEmail: auth.user.email, action: "delete", leadId,
    company: strField(lead.broker, "company_name"), mcNumber: strField(lead.broker, "mc_number"),
    details: { stage: lead.stage, assigned_agent_id: lead.assignedAgentId, broker: lead.broker, deleted_events: lead.eventCount },
  })
  if (!recorded) return fail("Couldn't record this deletion in the audit log, so nothing was deleted.")

  const res = await deps.deleteLeadRow(leadId)
  if (res.error) return fail(`Delete failed: ${res.error}`)
  if (res.deleted === 0) return fail("Nothing was deleted (the lead may already be gone, or you don't have permission).")
  return { ok: true, message: `Lead deleted (${lead.eventCount} activity record${lead.eventCount === 1 ? "" : "s"} removed with it)` }
}
