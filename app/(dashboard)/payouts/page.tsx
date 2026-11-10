import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { effectiveStatus, toCents, todayIn, type EntryKind, type EntryStatus } from "@/lib/commission"
import type { PayoutDetails } from "@/lib/payout-details"
import { PayoutsClient, type PayoutEntry } from "./payouts-client"

// Admin only: what each agent is owed on each 15th, and marking it paid.
export default async function PayoutsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")
  if (user.app_metadata?.role !== "admin") redirect("/dashboard")

  const [{ data: entriesRaw }, { data: customersRaw }, { data: paymentsRaw }, { data: agentsRaw }, { data: detailsRaw }] = await Promise.all([
    (supabase.from("commission_entries") as any).select("*").order("payout_date", { ascending: true }),
    (supabase.from("customers") as any).select("id, company_name, status"),
    (supabase.from("customer_payments") as any).select("id, received_at, amount_usd"),
    (supabase.from("agents") as any).select("*"),
    // Where each agent is paid (admins read every row; empty if the table is not there yet).
    (supabase.from("agent_payout_details") as any).select("*"),
  ])
  const payoutDetails: Record<string, PayoutDetails> = Object.fromEntries(((detailsRaw ?? []) as any[]).map((d) => [d.agent_id, d]))
  const agentList = ((agentsRaw ?? []) as any[])
    .filter((a) => !a.deleted_at && a.active !== false)
    .map((a) => ({ id: a.id as string, name: a.name as string }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const today = todayIn()
  const customers = new Map(((customersRaw ?? []) as any[]).map((c) => [c.id as string, c]))
  const payments = new Map(((paymentsRaw ?? []) as any[]).map((p) => [p.id as string, p]))
  const agents = new Map(
    ((agentsRaw ?? []) as any[]).map((a) => [a.id as string, { name: a.name as string, left: !!a.left_at || a.active === false }]),
  )

  const entries: PayoutEntry[] = ((entriesRaw ?? []) as any[]).map((e) => {
    const c = customers.get(e.customer_id)
    const p = payments.get(e.payment_id)
    return {
      id: e.id,
      agentId: e.agent_id,
      agentName: agents.get(e.agent_id)?.name ?? "—",
      agentLeft: agents.get(e.agent_id)?.left ?? false,
      company: c?.company_name ?? "—",
      kind: e.kind as EntryKind,
      level: e.level,
      rate: Number(e.rate),
      baseCents: toCents(e.base_usd),
      amountCents: toCents(e.amount_usd),
      receivedAt: p?.received_at ?? null,
      payoutDate: e.payout_date,
      status: effectiveStatus(e, today, c?.status === "active") as EntryStatus,
      storedStatus: e.status as EntryStatus,
      paidAt: e.paid_at ?? null,
      paidReference: e.paid_reference ?? null,
      note: e.note ?? null,
    }
  })

  return (
    <div className="p-3 sm:p-6 max-w-5xl mx-auto">
      <PayoutsClient entries={entries} today={today} payoutDetails={payoutDetails} agentList={agentList} />
    </div>
  )
}
