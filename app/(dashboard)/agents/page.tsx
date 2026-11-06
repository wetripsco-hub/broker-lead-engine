import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { todayIn } from "@/lib/commission"
import { buildAgentEarnings, type CustomerRow, type EntryRow, type PaymentRow } from "@/lib/earnings"
import { AgentsClient, type AgentEarningsBrief } from "./agents-client"

export default async function AgentsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")
  // Server-side gate — the sidebar hides this link for agents, but that
  // alone doesn't stop a direct URL visit.
  if (user.user_metadata?.role !== "admin") redirect("/leads")

  // select("*") so a column whose migration isn't applied yet just comes back
  // missing instead of failing the whole page. Deleted agents (kept for their
  // history) are hidden.
  const [{ data: agentsRaw }, lastSignIn] = await Promise.all([
    supabase.from("agents").select("*").order("created_at", { ascending: true }),
    lastSignInByUser(),
  ])
  const agents = ((agentsRaw ?? []) as any[])
    .filter((a) => !a.deleted_at)
    .map((a) => ({
      id: a.id as string,
      name: a.name as string,
      email: (a.email ?? null) as string | null,
      active: a.active as boolean,
      created_at: a.created_at as string,
      onboarding_completed_at: (a.onboarding_completed_at ?? null) as string | null,
      last_seen_at: (a.last_seen_at ?? null) as string | null,
      last_signed_out_at: (a.last_signed_out_at ?? null) as string | null,
      last_sign_in_at: lastSignIn.get(a.user_id) ?? null,
      ip_timezone: (a.ip_timezone ?? null) as string | null,
      ip_country: (a.ip_country ?? null) as string | null,
      ip_city: (a.ip_city ?? null) as string | null,
      ip_location_at: (a.ip_location_at ?? null) as string | null,
    }))

  const { data: leadCountsRaw } = await supabase
    .from("leads")
    .select("assigned_agent_id")
    .not("assigned_agent_id", "is", null)

  const leadCounts: Record<string, number> = {}
  for (const l of (leadCountsRaw ?? []) as Array<{ assigned_agent_id: string }>) {
    leadCounts[l.assigned_agent_id] = (leadCounts[l.assigned_agent_id] ?? 0) + 1
  }

  // Earnings per agent (level, active customers, this month, next payout, total so far).
  // Tables missing (migration not run) just mean no earnings line.
  const [{ data: customersRaw }, { data: paymentsRaw }, { data: entriesRaw }] = await Promise.all([
    (supabase.from("customers") as any).select("*"),
    (supabase.from("customer_payments") as any).select("id, customer_id, received_at, amount_usd, covers"),
    (supabase.from("commission_entries") as any).select("*"),
  ])
  const today = todayIn()
  const earnings: Record<string, AgentEarningsBrief> = {}
  for (const a of (agentsRaw ?? []) as any[]) {
    if (a.deleted_at) continue
    const e = buildAgentEarnings(
      { id: a.id, comp_type: a.comp_type ?? "commission", custom_rate: a.custom_rate ?? null },
      (customersRaw ?? []) as CustomerRow[],
      (paymentsRaw ?? []) as PaymentRow[],
      (entriesRaw ?? []) as EntryRow[],
      today,
    )
    earnings[a.id] = {
      levelName: e.level.name,
      levelEmoji: e.level.emoji,
      rate: e.rate,
      customRate: e.customRate,
      activeCustomers: e.activeCustomers,
      thisMonthCents: e.summary.thisMonthEarnedCents,
      nextPayoutDate: e.summary.nextPayoutDate,
      nextPayoutCents: e.summary.nextPayoutCents,
      totalSoFarCents: e.summary.totalSoFarCents,
      compType: a.comp_type === "salary_plus_commission" ? "salary_plus_commission" : "commission",
      customRateValue: a.custom_rate === null || a.custom_rate === undefined ? null : Number(a.custom_rate),
    }
  }

  return (
    <div className="p-3 sm:p-6 max-w-4xl mx-auto">
      <AgentsClient agents={agents} leadCounts={leadCounts} earnings={earnings} />
    </div>
  )
}

/** Last successful sign-in per auth user (Supabase Auth keeps it; the agents table doesn't). */
async function lastSignInByUser(): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  try {
    const { data } = await createAdminClient().auth.admin.listUsers({ page: 1, perPage: 1000 })
    for (const u of data?.users ?? []) if (u.last_sign_in_at) out.set(u.id, u.last_sign_in_at)
  } catch {
    /* page still works without it */
  }
  return out
}
