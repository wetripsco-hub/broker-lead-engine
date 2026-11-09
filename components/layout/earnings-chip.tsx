// Agent's level + balance in the top header, on every page. Server-rendered from
// the agent's OWN rows only (RLS). Balance = commission earned and not yet paid
// (pending); scheduled yearly 2nd halves are not counted until they are due.

import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { formatDay, formatRate, formatUsd, todayIn } from "@/lib/commission"
import { toCommissionLevels } from "@/lib/agent-terms"
import { loadMyTerms } from "@/lib/agent-terms-server"
import { buildAgentEarnings, type CustomerRow, type EntryRow, type PaymentRow } from "@/lib/earnings"

export async function EarningsChip({ agentId }: { agentId: string }) {
  const supabase = await createClient()
  const [{ data: agentRaw }, { data: customersRaw }, { data: paymentsRaw }, { data: entriesRaw }, myTerms] = await Promise.all([
    (supabase.from("agents") as any).select("id, comp_type, custom_rate").eq("id", agentId).maybeSingle(),
    (supabase.from("customers") as any).select("*").eq("agent_id", agentId),
    (supabase.from("customer_payments") as any).select("id, customer_id, received_at, amount_usd, covers"),
    (supabase.from("commission_entries") as any).select("*").eq("agent_id", agentId),
    loadMyTerms(supabase as any),
  ])
  if (!agentRaw) return null

  const e = buildAgentEarnings(
    { id: agentRaw.id, comp_type: agentRaw.comp_type ?? "commission", custom_rate: agentRaw.custom_rate ?? null },
    (customersRaw ?? []) as CustomerRow[],
    (paymentsRaw ?? []) as PaymentRow[],
    (entriesRaw ?? []) as EntryRow[],
    todayIn(),
    toCommissionLevels(myTerms.levels),
  )
  const s = e.summary
  const title = [
    `${e.level.name} level, ${formatRate(e.rate)} commission, ${e.activeCustomers} active paying customers`,
    `Balance (earned, not paid yet): ${formatUsd(s.pendingCents)}`,
    `This month: ${formatUsd(s.thisMonthEarnedCents)} (from money received this month)`,
    `Monthly recurring: ${formatUsd(e.monthlyRecurringCents)}/month from ${e.monthlyRecurringCustomers} active monthly customers`,
    s.nextPayoutDate ? `Next payout: ${formatUsd(s.nextPayoutCents)} on ${formatDay(s.nextPayoutDate)}` : "No payout pending yet",
    `Paid so far: ${formatUsd(s.paidTotalCents)}`,
  ].join("\n")

  return (
    <Link
      href="/dashboard"
      title={title}
      aria-label={`My earnings: ${e.level.name} level, balance ${formatUsd(s.pendingCents)}, this month ${formatUsd(s.thisMonthEarnedCents)}, monthly recurring ${formatUsd(e.monthlyRecurringCents)}`}
      className="ml-auto inline-flex items-center gap-2 rounded-full border bg-card px-2.5 py-1 text-xs shadow-sm transition-colors duration-150 hover:bg-muted"
    >
      <span className="inline-flex items-center gap-1 font-medium">
        <span aria-hidden className="text-sm leading-none">
          {e.level.emoji}
        </span>
        <span className="hidden sm:inline">{e.level.name}</span>
        <span className="text-muted-foreground">{formatRate(e.rate)}</span>
      </span>
      <span className="h-3.5 w-px bg-border" aria-hidden />
      <span className="inline-flex items-center gap-1">
        <span className="hidden sm:inline text-muted-foreground">Balance</span>
        <span className="font-semibold tabular-nums">{formatUsd(s.pendingCents)}</span>
      </span>
      {/* Small screens: level + balance only; the rest is in the hover title. */}
      <span className="hidden md:block h-3.5 w-px bg-border" aria-hidden />
      <span className="hidden md:inline-flex items-center gap-1">
        <span className="text-muted-foreground">This month</span>
        <span className="font-semibold tabular-nums">{formatUsd(s.thisMonthEarnedCents)}</span>
      </span>
      <span className="hidden md:block h-3.5 w-px bg-border" aria-hidden />
      <span className="hidden md:inline-flex items-center gap-1">
        <span className="text-muted-foreground">Monthly recurring</span>
        <span className="font-semibold tabular-nums">{formatUsd(e.monthlyRecurringCents)}</span>
        <span className="text-muted-foreground">/mo</span>
      </span>
    </Link>
  )
}
