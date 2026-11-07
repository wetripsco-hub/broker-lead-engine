// Agent earnings rules (doc/AGENT_EARNINGS_LEVELS_RUNBOOK.md §2). Pure functions, no DB.
//
// - Commission only on money actually received. Monthly: level % of the full amount.
//   Yearly: 50% in the next payout, 50% six months later (only if still active).
// - Level = number of ACTIVE customers right now; goes up and down with them.
// - Payout day is the 15th of the month after the money was received.
// - All money math is in integer cents; rates are converted to basis points.

export type LevelId = "bronze" | "silver" | "gold" | "platinum"
export type CompType = "commission" | "salary_plus_commission"
export type EntryKind = "monthly" | "yearly_first_half" | "yearly_second_half" | "adjustment"
export type EntryStatus = "pending" | "scheduled" | "paid" | "void"
export type Covers = "month" | "year"

export interface Level {
  id: LevelId
  name: string
  emoji: string
  min: number
  rate: number
  salaryOption?: boolean
}

export const LEVELS: Level[] = [
  { id: "bronze", name: "Bronze", emoji: "🥉", min: 0, rate: 0.3 },
  { id: "silver", name: "Silver", emoji: "🥈", min: 10, rate: 0.35 },
  { id: "gold", name: "Gold", emoji: "🥇", min: 25, rate: 0.4 },
  { id: "platinum", name: "Platinum", emoji: "💎", min: 50, rate: 0.4, salaryOption: true },
]

/** Monthly list prices (USD) used by the agent's calculator. */
export const PLAN_PRICES = [
  { id: "starter", name: "Starter", usd: 69 },
  { id: "growth", name: "Growth", usd: 189 },
  { id: "scale", name: "Scale", usd: 799 },
] as const

export const PLANS = ["starter", "growth", "scale", "custom"] as const
export type Plan = (typeof PLANS)[number]

/** A scheduled entry shows as pending once its payout is this close (and the customer is active). */
export const SCHEDULED_TO_PENDING_DAYS = 31
/** A monthly customer with no payment for this long is flagged "payment overdue?" (display only). */
export const OVERDUE_DAYS = 35

// ── Levels ───────────────────────────────────────────────────────────────────

export function levelFor(activeCustomers: number): Level {
  const n = Math.max(0, Math.floor(activeCustomers || 0))
  let out = LEVELS[0]
  for (const l of LEVELS) if (n >= l.min) out = l
  return out
}

/** The next level and how many more active customers it needs, or null at the top. */
export function nextLevel(activeCustomers: number): { level: Level; needed: number } | null {
  const n = Math.max(0, Math.floor(activeCustomers || 0))
  const next = LEVELS.find((l) => l.min > n)
  return next ? { level: next, needed: next.min - n } : null
}

export interface AgentComp {
  comp_type?: CompType | string | null
  custom_rate?: number | string | null
}

function customRateOf(agent: AgentComp | null | undefined): number | null {
  const raw = agent?.custom_rate
  if (raw === null || raw === undefined || raw === "") return null
  const r = Number(raw)
  return Number.isFinite(r) && r >= 0 && r <= 1 ? r : null
}

/** The agent's custom rate if the admin set one, otherwise the level rate. */
export function rateFor(agent: AgentComp | null | undefined, activeCustomers: number): number {
  return customRateOf(agent) ?? levelFor(activeCustomers).rate
}

/** What goes in commission_entries.level: the level id, or "custom" when a custom rate applies. */
export function levelLabelFor(agent: AgentComp | null | undefined, activeCustomers: number): LevelId | "custom" {
  return customRateOf(agent) !== null ? "custom" : levelFor(activeCustomers).id
}

// ── Money (integer cents) ────────────────────────────────────────────────────

/** "189", "189.5", 189.5 → 18950. Rounds to the nearest cent. */
export function toCents(usd: number | string | null | undefined): number {
  if (usd === null || usd === undefined || usd === "") return 0
  const s = String(usd).trim().replace(/[$,\s]/g, "")
  const m = s.match(/^(-)?(\d*)(?:\.(\d*))?$/)
  if (!m) return Math.round(Number(s) * 100) || 0
  const sign = m[1] ? -1 : 1
  const whole = Number(m[2] || "0")
  const frac = (m[3] ?? "").padEnd(3, "0")
  let cents = whole * 100 + Number(frac.slice(0, 2))
  if (Number(frac[2]) >= 5) cents += 1
  return sign * cents
}

/** 0.35 → 3500 basis points (exact integer). */
export function rateToBp(rate: number | string): number {
  return Math.round(Number(rate) * 10000)
}

/** cents × rate, rounded half away from zero, all in integers. */
export function applyRate(cents: number, rate: number | string): number {
  const bp = rateToBp(rate)
  const raw = cents * bp
  const sign = raw < 0 ? -1 : 1
  return sign * Math.floor((Math.abs(raw) + 5000) / 10000)
}

/** 5670 → "$56.70"; -500 → "−$5.00". */
export function formatUsd(cents: number): string {
  const sign = cents < 0 ? "−" : ""
  const abs = Math.abs(Math.round(cents))
  const dollars = Math.floor(abs / 100).toLocaleString("en-US")
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")}`
}

/** 0.35 → "35%", 0.375 → "37.5%". */
export function formatRate(rate: number | string): string {
  const pct = rateToBp(rate) / 100
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2).replace(/0+$/, "")}%`
}

// ── Dates (YYYY-MM-DD strings, no time zones involved) ──────────────────────

function ymd(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number)
  return { y, m, d }
}

function fifteenthOf(y: number, m: number): string {
  // m may run past 12; normalise.
  const yy = y + Math.floor((m - 1) / 12)
  const mm = ((((m - 1) % 12) + 12) % 12) + 1
  return `${yy}-${String(mm).padStart(2, "0")}-15`
}

/** The 15th of the month after the money was received. */
export function payoutDateFor(receivedAt: string): string {
  const { y, m } = ymd(receivedAt)
  return fifteenthOf(y, m + 1)
}

/** The 15th, `months` months after `date`'s month. */
export function addMonths15(date: string, months: number): string {
  const { y, m } = ymd(date)
  return fifteenthOf(y, m + months)
}

/** Next payout day on or after `today` (the 15th of this month, or of next month). */
export function nextPayoutDay(today: string): string {
  const { y, m, d } = ymd(today)
  return d <= 15 ? fifteenthOf(y, m) : fifteenthOf(y, m + 1)
}

export function daysBetween(from: string, to: string): number {
  const a = ymd(from)
  const b = ymd(to)
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000)
}

/** Today's date (YYYY-MM-DD) in a time zone. The company books money in Pakistan time. */
export function todayIn(tz = "Asia/Karachi", now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now)
}

/** "2026-12-15" → "15 Dec 2026". */
export function formatDay(iso: string | null | undefined): string {
  if (!iso) return "—"
  const { y, m, d } = ymd(iso)
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]
  return `${d} ${mon} ${y}`
}

// ── Entries for one payment ──────────────────────────────────────────────────

export interface EntryDraft {
  kind: EntryKind
  level: string
  rate: number
  base_cents: number
  amount_cents: number
  payout_date: string
  status: EntryStatus
}

export function entriesForPayment(
  payment: { received_at: string; amount_cents: number; covers: Covers },
  rate: number,
  level: string,
): EntryDraft[] {
  const payout = payoutDateFor(payment.received_at)
  if (payment.covers === "month") {
    return [
      {
        kind: "monthly",
        level,
        rate,
        base_cents: payment.amount_cents,
        amount_cents: applyRate(payment.amount_cents, rate),
        payout_date: payout,
        status: "pending",
      },
    ]
  }
  // Yearly: split in two; any odd cent goes to the first half.
  const first = Math.ceil(payment.amount_cents / 2)
  const second = payment.amount_cents - first
  return [
    {
      kind: "yearly_first_half",
      level,
      rate,
      base_cents: first,
      amount_cents: applyRate(first, rate),
      payout_date: payout,
      status: "pending",
    },
    {
      kind: "yearly_second_half",
      level,
      rate,
      base_cents: second,
      amount_cents: applyRate(second, rate),
      payout_date: addMonths15(payout, 6),
      status: "scheduled",
    },
  ]
}

/** Why a payment creates no commission, or null when it does. */
export function noCommissionReason(
  agent: { left_at?: string | null } | null,
  customer: { status: string },
  receivedAt: string,
): string | null {
  if (customer.status === "cancelled") return "the customer is cancelled"
  if (agent?.left_at && receivedAt.slice(0, 10) > agent.left_at.slice(0, 10)) return "the agent has left"
  return null
}

// ── Reading entries ──────────────────────────────────────────────────────────

/** Scheduled → pending on read, once the payout is within 31 days and the customer is still active. */
export function effectiveStatus(
  entry: { status: EntryStatus | string; payout_date: string },
  today: string,
  customerActive: boolean,
): EntryStatus {
  const s = entry.status as EntryStatus
  if (s === "scheduled" && customerActive && daysBetween(today, entry.payout_date) <= SCHEDULED_TO_PENDING_DAYS) {
    return "pending"
  }
  return s
}

export interface SummaryEntry {
  /** Already the effective status (see effectiveStatus). */
  status: EntryStatus
  amount_cents: number
  payout_date: string
  /** When the payment behind this entry was received. */
  received_at: string
}

export interface EarningsSummary {
  nextPayoutDate: string | null
  nextPayoutCents: number
  thisMonthEarnedCents: number
  paidTotalCents: number
  pendingCents: number
  scheduledCents: number
  totalSoFarCents: number
}

export function summaryFor(entries: SummaryEntry[], today: string): EarningsSummary {
  const month = today.slice(0, 7)
  let paid = 0
  let pending = 0
  let scheduled = 0
  let thisMonth = 0
  let nextDate: string | null = null
  for (const e of entries) {
    if (e.status === "void") continue
    if (e.received_at.slice(0, 7) === month) thisMonth += e.amount_cents
    if (e.status === "paid") paid += e.amount_cents
    else if (e.status === "pending") {
      pending += e.amount_cents
      if (!nextDate || e.payout_date < nextDate) nextDate = e.payout_date
    } else if (e.status === "scheduled") scheduled += e.amount_cents
  }
  const nextCents = nextDate
    ? entries.filter((e) => e.status === "pending" && e.payout_date === nextDate).reduce((s, e) => s + e.amount_cents, 0)
    : 0
  return {
    nextPayoutDate: nextDate,
    nextPayoutCents: nextCents,
    thisMonthEarnedCents: thisMonth,
    paidTotalCents: paid,
    pendingCents: pending,
    scheduledCents: scheduled,
    totalSoFarCents: paid + pending,
  }
}

/** Commission per month from active monthly customers, using each one's latest monthly payment. */
export function monthlyRecurringCents(latestMonthlyCents: number[], rate: number): number {
  return latestMonthlyCents.reduce((sum, c) => sum + applyRate(c, rate), 0)
}

/** Calculator: N customers on a plan at the agent's rate, per month. */
export function calculatorCents(planUsd: number, customers: number, rate: number): number {
  const n = Math.max(0, Math.floor(customers || 0))
  return applyRate(toCents(planUsd) * n, rate)
}

export const KIND_LABEL: Record<EntryKind, string> = {
  monthly: "Monthly",
  yearly_first_half: "Yearly 1st half",
  yearly_second_half: "Yearly 2nd half",
  adjustment: "Adjustment",
}

export const STATUS_LABEL: Record<EntryStatus, string> = {
  pending: "Pending",
  scheduled: "Scheduled",
  paid: "Paid",
  void: "Void",
}

export function levelById(id: string | null | undefined): Level | null {
  return LEVELS.find((l) => l.id === id) ?? null
}
