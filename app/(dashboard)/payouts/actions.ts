"use server"

// Admin-only payout actions (doc/AGENT_EARNINGS_LEVELS_RUNBOOK.md §3). Each one re-checks
// admin in the DB before writing with the service role.

import { revalidatePath } from "next/cache"
import { applyRate, effectiveStatus, nextPayoutDay, toCents, todayIn } from "@/lib/commission"
import { adminDbOrNull, validIsoDate } from "@/lib/earnings-admin"

type Result = { error: string | null; note?: string }

function revalidateAll() {
  revalidatePath("/payouts")
  revalidatePath("/customers")
  revalidatePath("/agents")
  revalidatePath("/dashboard")
}

/**
 * Marks everything an agent is owed on one payout date as paid. Includes yearly 2nd
 * halves that already show as pending (within 31 days, customer active).
 */
export async function markPaid(agentId: string, payoutDate: string, reference: string): Promise<Result> {
  const admin = await adminDbOrNull()
  if (!admin) return { error: "Admin access required" }
  if (!validIsoDate(payoutDate)) return { error: "Payout date is not valid" }
  const ref = reference.trim()
  if (!ref) return { error: "Add the payment reference (Wise / Payoneer / bank)" }

  const { data: rows, error: readError } = await (admin.from("commission_entries") as any)
    .select("id, status, payout_date, customers ( status )")
    .eq("agent_id", agentId)
    .eq("payout_date", payoutDate)
    .in("status", ["pending", "scheduled"])
  if (readError) return { error: readError.message }

  const today = todayIn()
  const ids = ((rows ?? []) as Array<{ id: string; status: string; payout_date: string; customers: { status: string } | null }>)
    .filter((r) => effectiveStatus(r, today, r.customers?.status === "active") === "pending")
    .map((r) => r.id)
  if (ids.length === 0) return { error: "Nothing pending for this agent on that date" }

  const { error } = await (admin.from("commission_entries") as any)
    .update({ status: "paid", paid_at: new Date().toISOString(), paid_reference: ref.slice(0, 200) })
    .in("id", ids)
  if (error) return { error: error.message }

  revalidateAll()
  return { error: null, note: `${ids.length} entr${ids.length === 1 ? "y" : "ies"} marked paid.` }
}

/** Voids one unpaid entry (e.g. for an agent who left). A note is required. */
export async function voidEntry(entryId: string, note: string): Promise<Result> {
  const admin = await adminDbOrNull()
  if (!admin) return { error: "Admin access required" }
  const why = note.trim()
  if (!why) return { error: "Add a note: why is this voided?" }

  const { data, error } = await (admin.from("commission_entries") as any)
    .update({ status: "void", note: why.slice(0, 500) })
    .eq("id", entryId)
    .in("status", ["pending", "scheduled"])
    .select("id")
  if (error) return { error: error.message }
  if (!data?.length) return { error: "Only pending or scheduled entries can be voided" }

  revalidateAll()
  return { error: null }
}

/**
 * Admin override of one unpaid entry: a new rate (amount recomputed from the base) or
 * a new amount. A note is required. History of other entries is never touched.
 */
export async function overrideEntry(
  entryId: string,
  change: { ratePct?: number | null; amountUsd?: string | null },
  note: string,
): Promise<Result> {
  const admin = await adminDbOrNull()
  if (!admin) return { error: "Admin access required" }
  const why = note.trim()
  if (!why) return { error: "Add a note: why is this changed?" }

  const { data: entry } = await (admin.from("commission_entries") as any)
    .select("id, status, base_usd, rate")
    .eq("id", entryId)
    .maybeSingle()
  if (!entry) return { error: "Entry not found" }
  if (entry.status !== "pending" && entry.status !== "scheduled") return { error: "Paid or void entries can't be changed" }

  const update: Record<string, unknown> = { note: why.slice(0, 500) }
  if (change.ratePct !== null && change.ratePct !== undefined) {
    if (!Number.isFinite(change.ratePct) || change.ratePct < 0 || change.ratePct > 100) return { error: "Rate must be 0–100%" }
    const bp = Math.round(change.ratePct * 100)
    update.rate = bp / 10000
    update.amount_usd = applyRate(toCents(entry.base_usd), bp / 10000) / 100
  }
  if (change.amountUsd !== null && change.amountUsd !== undefined && change.amountUsd !== "") {
    update.amount_usd = toCents(change.amountUsd) / 100
  }
  if (update.rate === undefined && update.amount_usd === undefined) return { error: "Change the rate or the amount" }

  const { error } = await (admin.from("commission_entries") as any).update(update).eq("id", entryId)
  if (error) return { error: error.message }

  revalidateAll()
  return { error: null }
}

/**
 * Manual adjustment (can be negative) tied to the same customer payment as an existing
 * entry. Paid out on the given 15th (default: the next payout day). A note is required.
 */
export async function addAdjustment(entryId: string, amountUsd: string, payoutDate: string | null, note: string): Promise<Result> {
  const admin = await adminDbOrNull()
  if (!admin) return { error: "Admin access required" }
  const why = note.trim()
  if (!why) return { error: "Add a note: what is this adjustment for?" }
  const cents = toCents(amountUsd)
  if (!cents) return { error: "Enter an amount (use a minus sign to deduct)" }
  const date = payoutDate || nextPayoutDay(todayIn())
  if (!validIsoDate(date) || !date.endsWith("-15")) return { error: "Payout date must be the 15th of a month" }

  const { data: entry } = await (admin.from("commission_entries") as any)
    .select("agent_id, customer_id, payment_id")
    .eq("id", entryId)
    .maybeSingle()
  if (!entry) return { error: "Entry not found" }

  const { error } = await (admin.from("commission_entries") as any).insert({
    agent_id: entry.agent_id,
    customer_id: entry.customer_id,
    payment_id: entry.payment_id,
    kind: "adjustment",
    level: "adjustment",
    rate: 0,
    base_usd: 0,
    amount_usd: cents / 100,
    payout_date: date,
    status: "pending",
    note: why.slice(0, 500),
  })
  if (error) return { error: error.message }

  revalidateAll()
  return { error: null }
}
