// Server-only helpers for the admin earnings actions (customers / payouts).
// Every write goes through the service role AFTER the caller is confirmed admin in the DB.

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isAdminInDb } from "@/lib/voice-agents/admin-check"
import {
  entriesForPayment,
  levelLabelFor,
  noCommissionReason,
  rateFor,
  type Covers,
  type EntryDraft,
} from "@/lib/commission"

export type AdminDb = ReturnType<typeof createAdminClient>

/** The service-role client, or null when the signed-in user isn't an admin (checked in the DB). */
export async function adminDbOrNull(): Promise<AdminDb | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  return (await isAdminInDb(admin, user.id)) ? admin : null
}

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function validIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !ISO_DATE.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/**
 * The commission entries one payment creates, using the agent's level right now.
 * `addingCustomer` = the customer row doesn't exist yet but will count as active.
 */
export async function commissionDrafts(
  admin: AdminDb,
  args: {
    agentId: string
    customerStatus: string
    addingCustomer: boolean
    receivedAt: string
    amountCents: number
    covers: Covers
  },
): Promise<{ entries: EntryDraft[]; skipped: string | null }> {
  const { data: agent } = await (admin.from("agents") as any).select("*").eq("id", args.agentId).maybeSingle()
  if (!agent) return { entries: [], skipped: "agent not found" }

  const skipped = noCommissionReason(agent, { status: args.customerStatus }, args.receivedAt)
  if (skipped) return { entries: [], skipped }

  const { count } = await (admin.from("customers") as any)
    .select("id", { count: "exact", head: true })
    .eq("agent_id", args.agentId)
    .eq("status", "active")
  const active = (count ?? 0) + (args.addingCustomer ? 1 : 0)

  const rate = rateFor(agent, active)
  const level = levelLabelFor(agent, active)
  return {
    entries: entriesForPayment({ received_at: args.receivedAt, amount_cents: args.amountCents, covers: args.covers }, rate, level),
    skipped: null,
  }
}
