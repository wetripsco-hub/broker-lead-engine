// Agent's "My earnings" block at the top of their home page (runbook §5).
// Server-rendered from the agent's OWN rows only (RLS: agents select their own).
// Never shows other agents' numbers; no leaderboard.

import Link from "next/link"
import { BookOpenText, ChevronRight } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { formatDay, formatRate, formatUsd, KIND_LABEL, LEVELS, todayIn } from "@/lib/commission"
import { buildAgentEarnings, type CustomerRow, type EntryRow, type PaymentRow } from "@/lib/earnings"
import { EarningsCalculator } from "./earnings-calculator"
import { StatusPill } from "./status-pill"

export async function MyEarnings({ userId }: { userId: string }) {
  const supabase = await createClient()
  const { data: agentRaw } = await (supabase.from("agents") as any).select("*").eq("user_id", userId).maybeSingle()
  if (!agentRaw) return null

  const [{ data: customersRaw }, { data: paymentsRaw }, { data: entriesRaw }] = await Promise.all([
    (supabase.from("customers") as any).select("*").eq("agent_id", agentRaw.id),
    (supabase.from("customer_payments") as any).select("id, customer_id, received_at, amount_usd, covers"),
    (supabase.from("commission_entries") as any).select("*").eq("agent_id", agentRaw.id),
  ])

  const today = todayIn()
  const e = buildAgentEarnings(
    { id: agentRaw.id, comp_type: agentRaw.comp_type ?? "commission", custom_rate: agentRaw.custom_rate ?? null },
    (customersRaw ?? []) as CustomerRow[],
    (paymentsRaw ?? []) as PaymentRow[],
    (entriesRaw ?? []) as EntryRow[],
    today,
  )
  const s = e.summary

  // Progress inside the current level band towards the next one.
  const progress = e.next ? Math.min(100, Math.round(((e.activeCustomers - e.level.min) / (e.next.level.min - e.level.min)) * 100)) : 100

  const money = [
    {
      label: "Next payout",
      value: s.nextPayoutDate ? formatUsd(s.nextPayoutCents) : "—",
      sub: s.nextPayoutDate ? `on ${formatDay(s.nextPayoutDate)}` : "Nothing pending yet",
    },
    { label: "This month", value: formatUsd(s.thisMonthEarnedCents), sub: "From money received this month" },
    { label: "Paid so far", value: formatUsd(s.paidTotalCents), sub: "Already sent to you" },
    { label: "Total so far", value: formatUsd(s.totalSoFarCents), sub: "Paid + pending" },
  ]

  return (
    <section className="space-y-4" aria-labelledby="my-earnings">
      <h2 id="my-earnings" className="text-sm font-medium text-muted-foreground">
        My earnings
      </h2>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        {/* Level card */}
        <div className="rounded-xl border bg-card p-4 shadow-sm space-y-3 animate-in-rise">
          <div className="flex items-center gap-3">
            <span className="text-3xl leading-none" aria-hidden>
              {e.level.emoji}
            </span>
            <div className="min-w-0">
              <p className="text-lg font-semibold tracking-tight leading-tight">{e.level.name}</p>
              <p className="text-sm text-muted-foreground">
                {e.activeCustomers} active customer{e.activeCustomers === 1 ? "" : "s"}
              </p>
            </div>
            <div className="ml-auto text-right">
              <p className="text-2xl font-semibold tabular-nums leading-none">{formatRate(e.rate)}</p>
              <p className="text-[11px] text-muted-foreground mt-1">{e.customRate ? "your custom rate" : "your commission"}</p>
            </div>
          </div>
          <div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-primary transition-[width] duration-500 ease-[var(--ease-out)]" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-xs mt-1.5">
              {e.next ? (
                <>
                  <span className="font-medium">{e.next.level.name}:</span> {e.next.needed} more active customer{e.next.needed === 1 ? "" : "s"}
                </>
              ) : (
                "Top level reached"
              )}
            </p>
          </div>
          {e.salaryPlusCommission && <p className="text-xs font-medium text-primary">Salary + commission (agreed with admin)</p>}
          <p className="text-[11px] text-muted-foreground">Your level follows your active customers.</p>
        </div>

        <div className="space-y-4">
          {/* Money cards */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            {money.map((m, i) => (
              <div key={m.label} className="rounded-xl border bg-card p-3.5 shadow-sm animate-in-rise" style={{ animationDelay: `${50 + i * 40}ms` }}>
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{m.label}</p>
                <p className="text-xl font-semibold tracking-tight tabular-nums mt-1">{m.value}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{m.sub}</p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-xl border bg-card p-3.5 shadow-sm">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Monthly recurring</p>
              <p className="text-sm mt-1">
                <span className="text-xl font-semibold tabular-nums">{formatUsd(e.monthlyRecurringCents)}</span>
                <span className="text-muted-foreground"> / month</span>
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                from {e.monthlyRecurringCustomers} active monthly customer{e.monthlyRecurringCustomers === 1 ? "" : "s"}, while they keep paying
              </p>
            </div>
            <div className="rounded-xl border bg-card p-3.5 shadow-sm">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Scheduled</p>
              {e.scheduled.length === 0 ? (
                <p className="text-sm text-muted-foreground mt-1">No yearly 2nd halves scheduled.</p>
              ) : (
                <ul className="mt-1 space-y-0.5 text-sm">
                  {e.scheduled.slice(0, 4).map((l) => (
                    <li key={l.id} className="flex justify-between gap-2">
                      <span className="truncate text-muted-foreground">
                        {formatDay(l.payoutDate)} · {l.company}
                      </span>
                      <span className="tabular-nums font-medium">{formatUsd(l.amountCents)}</span>
                    </li>
                  ))}
                  {e.scheduled.length > 4 && <li className="text-[11px] text-muted-foreground">+{e.scheduled.length - 4} more</li>}
                </ul>
              )}
              <p className="text-[11px] text-muted-foreground mt-1">Yearly 2nd halves are paid if the customer is still active.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <EarningsCalculator rate={e.rate} />

        {/* Level roadmap */}
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <p className="text-sm font-medium">Level roadmap</p>
          <ul className="mt-3 space-y-1.5">
            {LEVELS.map((l, i) => {
              const nextMin = LEVELS[i + 1]?.min
              const current = l.id === e.level.id
              return (
                <li
                  key={l.id}
                  className={`flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm ${current ? "bg-primary/10 ring-1 ring-primary/30" : ""}`}
                  aria-current={current ? "true" : undefined}
                >
                  <span className="text-lg leading-none" aria-hidden>
                    {l.emoji}
                  </span>
                  <span className="font-medium w-20">{l.name}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {nextMin ? `${l.min}–${nextMin - 1}` : `${l.min}+`} active
                  </span>
                  <span className="ml-auto text-right tabular-nums font-medium">
                    {formatRate(l.rate)}
                    {l.salaryOption && <span className="block text-[11px] font-normal text-muted-foreground">Option: salary + commission</span>}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      </div>

      {/* Earnings list */}
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <p className="px-4 py-3 text-sm font-medium border-b">My earnings list</p>
        {e.lines.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            No earnings yet. When one of your customers pays, it shows up here.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-left text-xs text-muted-foreground uppercase tracking-wide border-b">
                  <th className="px-4 py-2 font-medium">Received</th>
                  <th className="px-3 py-2 font-medium">Company</th>
                  <th className="px-3 py-2 font-medium">Kind</th>
                  <th className="px-3 py-2 font-medium">Rate</th>
                  <th className="px-3 py-2 font-medium text-right">Amount</th>
                  <th className="px-3 py-2 font-medium">Payout</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {e.lines.map((l) => (
                  <tr key={l.id} className="border-b last:border-0">
                    <td className="px-4 py-2 tabular-nums text-muted-foreground">{formatDay(l.receivedAt)}</td>
                    <td className="px-3 py-2 font-medium">{l.company}</td>
                    <td className="px-3 py-2">{KIND_LABEL[l.kind]}</td>
                    <td className="px-3 py-2 tabular-nums">{l.kind === "adjustment" ? "—" : formatRate(l.rate)}</td>
                    <td className="px-3 py-2 tabular-nums text-right font-medium">{formatUsd(l.amountCents)}</td>
                    <td className="px-3 py-2 tabular-nums">{formatDay(l.payoutDate)}</td>
                    <td className="px-4 py-2">
                      <StatusPill status={l.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Learn your calling script */}
      <Link
        href="/script"
        className="group flex items-center gap-3 rounded-xl border bg-card p-4 shadow-sm transition-[transform,box-shadow,background-color] duration-200 ease-[var(--ease-out)] hover:shadow-md hover:-translate-y-0.5 hover:bg-muted/30"
      >
        <div className="size-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <BookOpenText className="size-4 text-primary" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium">Learn your calling script</p>
          <p className="text-xs text-muted-foreground">Quick call, normal call and the 15-minute demo, word for word.</p>
        </div>
        <ChevronRight className="ml-auto size-4 text-muted-foreground transition-transform duration-150 ease-[var(--ease-out)] group-hover:translate-x-0.5" />
      </Link>
    </section>
  )
}
