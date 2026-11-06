// Builds one agent's earnings view from their raw rows (pure, no DB) so the agent's
// home page, the admin Agents page and the tests all compute it the same way.

import {
  effectiveStatus,
  levelFor,
  levelLabelFor,
  monthlyRecurringCents,
  nextLevel,
  rateFor,
  summaryFor,
  toCents,
  type AgentComp,
  type EarningsSummary,
  type EntryKind,
  type EntryStatus,
  type Level,
} from "@/lib/commission"

export interface CustomerRow {
  id: string
  agent_id: string
  lead_id?: string | null
  company_name: string
  plan: string
  billing: "monthly" | "yearly" | string
  status: "active" | "cancelled" | string
  started_at: string
  cancelled_at?: string | null
}

export interface PaymentRow {
  id: string
  customer_id: string
  received_at: string
  amount_usd: number | string
  covers: "month" | "year" | string
}

export interface EntryRow {
  id: string
  agent_id: string
  customer_id: string
  payment_id: string
  kind: EntryKind | string
  level: string
  rate: number | string
  base_usd: number | string
  amount_usd: number | string
  payout_date: string
  status: EntryStatus | string
  paid_at?: string | null
  paid_reference?: string | null
  note?: string | null
  created_at?: string
}

export interface EarningsLine {
  id: string
  receivedAt: string
  company: string
  kind: EntryKind
  rate: number
  amountCents: number
  payoutDate: string
  status: EntryStatus
  note: string | null
}

export interface AgentEarnings {
  activeCustomers: number
  level: Level
  next: { level: Level; needed: number } | null
  rate: number
  rateLabel: string
  customRate: boolean
  salaryPlusCommission: boolean
  summary: EarningsSummary
  monthlyRecurringCents: number
  monthlyRecurringCustomers: number
  scheduled: EarningsLine[]
  lines: EarningsLine[]
}

export function buildAgentEarnings(
  agent: AgentComp & { id: string },
  customers: CustomerRow[],
  payments: PaymentRow[],
  entries: EntryRow[],
  today: string,
): AgentEarnings {
  const mine = customers.filter((c) => c.agent_id === agent.id)
  const byId = new Map(mine.map((c) => [c.id, c]))
  const active = mine.filter((c) => c.status === "active")
  const paymentById = new Map(payments.map((p) => [p.id, p]))

  const rate = rateFor(agent, active.length)
  const lines: EarningsLine[] = entries
    .filter((e) => e.agent_id === agent.id)
    .map((e) => {
      const c = byId.get(e.customer_id)
      const p = paymentById.get(e.payment_id)
      return {
        id: e.id,
        receivedAt: p?.received_at ?? e.payout_date,
        company: c?.company_name ?? "—",
        kind: e.kind as EntryKind,
        rate: Number(e.rate),
        amountCents: toCents(e.amount_usd),
        payoutDate: e.payout_date,
        status: effectiveStatus(e, today, c?.status === "active"),
        note: e.note ?? null,
      }
    })
    .sort((a, b) => (a.receivedAt === b.receivedAt ? b.payoutDate.localeCompare(a.payoutDate) : b.receivedAt.localeCompare(a.receivedAt)))

  const summary = summaryFor(
    lines.map((l) => ({ status: l.status, amount_cents: l.amountCents, payout_date: l.payoutDate, received_at: l.receivedAt })),
    today,
  )

  // Latest monthly payment of each active monthly customer.
  const latestMonthly: number[] = []
  for (const c of active) {
    if (c.billing !== "monthly") continue
    const latest = payments
      .filter((p) => p.customer_id === c.id && p.covers === "month")
      .sort((a, b) => b.received_at.localeCompare(a.received_at))[0]
    if (latest) latestMonthly.push(toCents(latest.amount_usd))
  }

  return {
    activeCustomers: active.length,
    level: levelFor(active.length),
    next: nextLevel(active.length),
    rate,
    rateLabel: levelLabelFor(agent, active.length),
    customRate: levelLabelFor(agent, active.length) === "custom",
    salaryPlusCommission: agent.comp_type === "salary_plus_commission",
    summary,
    monthlyRecurringCents: monthlyRecurringCents(latestMonthly, rate),
    monthlyRecurringCustomers: latestMonthly.length,
    scheduled: lines.filter((l) => l.status === "scheduled").sort((a, b) => a.payoutDate.localeCompare(b.payoutDate)),
    lines,
  }
}
