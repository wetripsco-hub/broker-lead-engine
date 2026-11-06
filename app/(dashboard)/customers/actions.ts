"use server"

// Admin-only: customers and the payments they make (doc/AGENT_EARNINGS_LEVELS_RUNBOOK.md §3).
// Each action re-checks admin in the DB (isAdminInDb via adminDbOrNull) — the page
// gate alone is not a security boundary.

import { revalidatePath } from "next/cache"
import { PLANS, toCents, type Covers } from "@/lib/commission"
import { adminDbOrNull, commissionDrafts, validIsoDate } from "@/lib/earnings-admin"

type Result = { error: string | null; note?: string }

function revalidateAll() {
  revalidatePath("/customers")
  revalidatePath("/payouts")
  revalidatePath("/agents")
  revalidatePath("/dashboard")
}

function skippedNote(skipped: string | null): string | undefined {
  return skipped ? `Payment saved. No commission: ${skipped}.` : undefined
}

export interface LeadHit {
  leadId: string
  company: string
  mc: string | null
  agentId: string | null
}

/** Lead search for "Add customer" (company name or MC number). */
export async function searchLeads(q: string): Promise<{ error: string | null; hits: LeadHit[] }> {
  const admin = await adminDbOrNull()
  if (!admin) return { error: "Admin access required", hits: [] }
  const term = q.trim().replace(/[%,()]/g, " ").slice(0, 60)
  if (term.length < 2) return { error: null, hits: [] }

  const { data: brokers } = await (admin.from("brokers") as any)
    .select("id, company_name, mc_number")
    .or(`company_name.ilike.%${term}%,mc_number.ilike.%${term.replace(/^MC-?/i, "")}%`)
    .limit(10)
  const list = (brokers ?? []) as Array<{ id: string; company_name: string | null; mc_number: string | null }>
  if (list.length === 0) return { error: null, hits: [] }

  const { data: leads } = await (admin.from("leads") as any)
    .select("id, broker_id, assigned_agent_id")
    .in("broker_id", list.map((b) => b.id))
  const hits: LeadHit[] = []
  for (const l of (leads ?? []) as Array<{ id: string; broker_id: string; assigned_agent_id: string | null }>) {
    const b = list.find((x) => x.id === l.broker_id)
    if (!b) continue
    hits.push({ leadId: l.id, company: b.company_name ?? `MC-${b.mc_number ?? "?"}`, mc: b.mc_number, agentId: l.assigned_agent_id })
  }
  return { error: null, hits: hits.slice(0, 10) }
}

export interface AddCustomerInput {
  agentId: string
  leadId: string | null
  companyName: string
  plan: string
  billing: "monthly" | "yearly"
  startedAt: string
  amountUsd: string
  receivedAt: string
  notes?: string
}

/** Creates the customer + first payment + its commission, in one transaction. */
export async function addCustomer(input: AddCustomerInput): Promise<Result> {
  const admin = await adminDbOrNull()
  if (!admin) return { error: "Admin access required" }

  const company = input.companyName?.trim()
  if (!input.agentId) return { error: "Pick an agent" }
  if (!company) return { error: "Company name is required" }
  if (!(PLANS as readonly string[]).includes(input.plan)) return { error: "Pick a plan" }
  if (input.billing !== "monthly" && input.billing !== "yearly") return { error: "Pick monthly or yearly" }
  if (!validIsoDate(input.startedAt)) return { error: "Start date is not valid" }
  if (!validIsoDate(input.receivedAt)) return { error: "Payment date is not valid" }
  const amountCents = toCents(input.amountUsd)
  if (!(amountCents > 0)) return { error: "First payment must be more than $0" }

  const covers: Covers = input.billing === "yearly" ? "year" : "month"
  const { entries, skipped } = await commissionDrafts(admin, {
    agentId: input.agentId,
    customerStatus: "active",
    addingCustomer: true,
    receivedAt: input.receivedAt,
    amountCents,
    covers,
  })

  const { error } = await (admin as any).rpc("record_customer_payment", {
    p_customer_id: null,
    p_new_customer: {
      agent_id: input.agentId,
      lead_id: input.leadId ?? "",
      company_name: company.slice(0, 200),
      plan: input.plan,
      billing: input.billing,
      started_at: input.startedAt,
      notes: (input.notes ?? "").trim().slice(0, 2000),
    },
    p_received_at: input.receivedAt,
    p_amount_cents: amountCents,
    p_covers: covers,
    p_note: null,
    p_entries: entries,
  })
  if (error) return { error: error.message }

  revalidateAll()
  return { error: null, note: skippedNote(skipped) }
}

export interface RecordPaymentInput {
  customerId: string
  amountUsd: string
  receivedAt: string
  covers: Covers
  note?: string
}

/** Money received from an existing customer → payment + commission, in one transaction. */
export async function recordPayment(input: RecordPaymentInput): Promise<Result> {
  const admin = await adminDbOrNull()
  if (!admin) return { error: "Admin access required" }

  if (!validIsoDate(input.receivedAt)) return { error: "Payment date is not valid" }
  if (input.covers !== "month" && input.covers !== "year") return { error: "Pick month or year" }
  const amountCents = toCents(input.amountUsd)
  if (!(amountCents > 0)) return { error: "Amount must be more than $0" }

  const { data: customer } = await (admin.from("customers") as any)
    .select("id, agent_id, status")
    .eq("id", input.customerId)
    .maybeSingle()
  if (!customer) return { error: "Customer not found" }

  const { entries, skipped } = await commissionDrafts(admin, {
    agentId: customer.agent_id,
    customerStatus: customer.status,
    addingCustomer: false,
    receivedAt: input.receivedAt,
    amountCents,
    covers: input.covers,
  })

  const { error } = await (admin as any).rpc("record_customer_payment", {
    p_customer_id: customer.id,
    p_new_customer: null,
    p_received_at: input.receivedAt,
    p_amount_cents: amountCents,
    p_covers: input.covers,
    p_note: (input.note ?? "").trim().slice(0, 500),
    p_entries: entries,
  })
  if (error) return { error: error.message }

  revalidateAll()
  return { error: null, note: skippedNote(skipped) }
}

/** Cancelled customers stop counting for the level; scheduled yearly 2nd halves are voided. */
export async function cancelCustomer(customerId: string, cancelledAt: string): Promise<Result> {
  const admin = await adminDbOrNull()
  if (!admin) return { error: "Admin access required" }
  if (!validIsoDate(cancelledAt)) return { error: "Cancel date is not valid" }

  const { data, error } = await (admin as any).rpc("cancel_customer", {
    p_customer_id: customerId,
    p_cancelled_at: cancelledAt,
  })
  if (error) return { error: error.message }

  revalidateAll()
  const voided = Number(data ?? 0)
  return { error: null, note: voided ? `${voided} scheduled yearly 2nd half voided.` : undefined }
}
