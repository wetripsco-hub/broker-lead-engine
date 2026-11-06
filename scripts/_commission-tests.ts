// Agent earnings rules (doc/AGENT_EARNINGS_LEVELS_RUNBOOK.md).
// Run: npx tsx scripts/_commission-tests.ts
import { readFileSync, existsSync } from "node:fs"
import {
  addMonths15,
  applyRate,
  calculatorCents,
  effectiveStatus,
  entriesForPayment,
  formatRate,
  formatUsd,
  levelFor,
  levelLabelFor,
  monthlyRecurringCents,
  nextLevel,
  nextPayoutDay,
  noCommissionReason,
  payoutDateFor,
  rateFor,
  summaryFor,
  toCents,
} from "@/lib/commission"
import { buildAgentEarnings, type CustomerRow, type EntryRow, type PaymentRow } from "@/lib/earnings"
import { CALL_SCRIPT, GUIDED_ORDER } from "@/lib/call-script/script"

let failures = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : `\n        got ${JSON.stringify(detail)}`}`)
}

// ── Levels ───────────────────────────────────────────────────────────────────
const lv = (n: number) => levelFor(n).id
check("level: 0 → Bronze", lv(0) === "bronze")
check("level: 9 → Bronze", lv(9) === "bronze")
check("level: 10 → Silver", lv(10) === "silver")
check("level: 24 → Silver", lv(24) === "silver")
check("level: 25 → Gold", lv(25) === "gold")
check("level: 49 → Gold", lv(49) === "gold")
check("level: 50 → Platinum", lv(50) === "platinum")
check("level: 120 → Platinum", lv(120) === "platinum")
check("level: rates 30/35/40/40", [0, 10, 25, 50].map((n) => levelFor(n).rate).join() === "0.3,0.35,0.4,0.4")
check("level: Platinum has the salary option", levelFor(50).salaryOption === true && !levelFor(49).salaryOption)
check("level goes down when a customer cancels (10 → 9 = Silver → Bronze)", lv(10) === "silver" && lv(10 - 1) === "bronze")
check("next level: 1 active → Silver, 9 more", nextLevel(1)?.level.id === "silver" && nextLevel(1)?.needed === 9)
check("next level: 10 → Gold, 15 more", nextLevel(10)?.level.id === "gold" && nextLevel(10)?.needed === 15)
check("next level: 49 → Platinum, 1 more", nextLevel(49)?.level.id === "platinum" && nextLevel(49)?.needed === 1)
check("next level: 50 → none", nextLevel(50) === null)

// ── Rates ────────────────────────────────────────────────────────────────────
check("rate: level rate without a custom rate", rateFor({ custom_rate: null }, 12) === 0.35)
check("rate: custom rate overrides the level", rateFor({ comp_type: "salary_plus_commission", custom_rate: 0.25 }, 60) === 0.25)
check("rate: custom rate as a numeric string", rateFor({ custom_rate: "0.4500" }, 0) === 0.45)
check("rate: stored level label is 'custom' with a custom rate", levelLabelFor({ custom_rate: 0.25 }, 3) === "custom" && levelLabelFor({}, 3) === "bronze")
check("rate: format", formatRate(0.35) === "35%" && formatRate(0.375) === "37.5%")

// ── Money in cents ───────────────────────────────────────────────────────────
check("cents: '189.00' → 18900", toCents("189.00") === 18900)
check("cents: 1814.4 → 181440", toCents(1814.4) === 181440)
check("cents: '$1,814.40' → 181440", toCents("$1,814.40") === 181440)
check("cents: 0.1 + 0.2 style input '0.30' → 30", toCents("0.30") === 30)
check("cents: three decimals round half up", toCents("10.005") === 1001)
check("cents: negative", toCents("-12.50") === -1250)
check("apply rate: 18900 × 30% = 5670", applyRate(18900, 0.3) === 5670)
check("apply rate: 90720 × 30% = 27216", applyRate(90720, 0.3) === 27216)
check("apply rate: rounds half up (1 cent × 50%)", applyRate(1, 0.5) === 1)
check("apply rate: negative rounds away from zero", applyRate(-1, 0.5) === -1)
check("format: $56.70, $1,234.00, −$5.00", formatUsd(5670) === "$56.70" && formatUsd(123400) === "$1,234.00" && formatUsd(-500) === "−$5.00")

// ── Payout dates ─────────────────────────────────────────────────────────────
check("payout: received 20 Nov 2026 → 15 Dec 2026", payoutDateFor("2026-11-20") === "2026-12-15")
check("payout: received 1 Dec 2026 → 15 Jan 2027", payoutDateFor("2026-12-01") === "2027-01-15")
check("payout: received 15 Jan → 15 Feb", payoutDateFor("2027-01-15") === "2027-02-15")
check("payout: +6 months from 15 Dec 2026 → 15 Jun 2027", addMonths15("2026-12-15", 6) === "2027-06-15")
check("payout: +6 months from 15 Aug → 15 Feb next year", addMonths15("2026-08-15", 6) === "2027-02-15")
check("next payout day: on the 15th → today; on the 16th → next month", nextPayoutDay("2026-12-15") === "2026-12-15" && nextPayoutDay("2026-12-16") === "2027-01-15")

// ── Entries for a payment ────────────────────────────────────────────────────
{
  const m = entriesForPayment({ received_at: "2026-11-20", amount_cents: 18900, covers: "month" }, 0.3, "bronze")
  check("monthly: one entry", m.length === 1 && m[0].kind === "monthly")
  check("monthly: $189 at 30% = $56.70", m[0].amount_cents === 5670 && m[0].base_cents === 18900)
  check("monthly: pending, payout 15 Dec", m[0].status === "pending" && m[0].payout_date === "2026-12-15")
  check("monthly: full amount incl. extra seats ($189 + 2×$25 = $239 → $71.70)",
    entriesForPayment({ received_at: "2026-11-20", amount_cents: 23900, covers: "month" }, 0.3, "bronze")[0].amount_cents === 7170)

  const y = entriesForPayment({ received_at: "2026-11-20", amount_cents: 181440, covers: "year" }, 0.3, "bronze")
  check("yearly: two entries", y.length === 2 && y[0].kind === "yearly_first_half" && y[1].kind === "yearly_second_half")
  check("yearly: each half $272.16 on a base of $907.20", y.every((e) => e.amount_cents === 27216 && e.base_cents === 90720))
  check("yearly: first half pending 15 Dec 2026", y[0].status === "pending" && y[0].payout_date === "2026-12-15")
  check("yearly: second half scheduled 15 Jun 2027", y[1].status === "scheduled" && y[1].payout_date === "2027-06-15")
  const odd = entriesForPayment({ received_at: "2026-11-20", amount_cents: 10001, covers: "year" }, 0.3, "bronze")
  check("yearly: odd cent goes to the first half, bases add up", odd[0].base_cents === 5001 && odd[1].base_cents === 5000)
  check("entries keep the rate and level they were made with", y.every((e) => e.rate === 0.3 && e.level === "bronze"))
}

// ── No commission ────────────────────────────────────────────────────────────
check("no commission: customer cancelled", noCommissionReason(null, { status: "cancelled" }, "2026-11-20") !== null)
check("no commission: payment after the agent left", noCommissionReason({ left_at: "2026-11-10T09:00:00Z" }, { status: "active" }, "2026-11-20") !== null)
check("commission: payment before the agent left still counts", noCommissionReason({ left_at: "2026-11-25T09:00:00Z" }, { status: "active" }, "2026-11-20") === null)
check("commission: active agent + active customer", noCommissionReason({ left_at: null }, { status: "active" }, "2026-11-20") === null)

// ── Scheduled → pending on read ──────────────────────────────────────────────
check("effective: scheduled far away stays scheduled", effectiveStatus({ status: "scheduled", payout_date: "2027-06-15" }, "2026-12-01", true) === "scheduled")
check("effective: scheduled within 31 days shows as pending", effectiveStatus({ status: "scheduled", payout_date: "2027-06-15" }, "2027-05-20", true) === "pending")
check("effective: not if the customer is no longer active", effectiveStatus({ status: "scheduled", payout_date: "2027-06-15" }, "2027-05-20", false) === "scheduled")
check("effective: paid stays paid", effectiveStatus({ status: "paid", payout_date: "2026-12-15" }, "2027-05-20", true) === "paid")

// ── Summary ──────────────────────────────────────────────────────────────────
{
  const today = "2026-11-25"
  const s = summaryFor(
    [
      { status: "pending", amount_cents: 5670, payout_date: "2026-12-15", received_at: "2026-11-20" },
      { status: "pending", amount_cents: 27216, payout_date: "2026-12-15", received_at: "2026-11-20" },
      { status: "scheduled", amount_cents: 27216, payout_date: "2027-06-15", received_at: "2026-11-20" },
      { status: "paid", amount_cents: 1000, payout_date: "2026-11-15", received_at: "2026-10-03" },
      { status: "void", amount_cents: 9999, payout_date: "2026-12-15", received_at: "2026-11-02" },
      { status: "pending", amount_cents: 700, payout_date: "2027-01-15", received_at: "2026-12-02" },
    ],
    today,
  )
  check("summary: next payout = nearest pending date (15 Dec)", s.nextPayoutDate === "2026-12-15")
  check("summary: next payout amount = pending on that date", s.nextPayoutCents === 5670 + 27216)
  check("summary: this month = payments received in Nov, not void (incl. scheduled half)", s.thisMonthEarnedCents === 5670 + 27216 + 27216)
  check("summary: paid total", s.paidTotalCents === 1000)
  check("summary: pending", s.pendingCents === 5670 + 27216 + 700)
  check("summary: scheduled", s.scheduledCents === 27216)
  check("summary: total so far = paid + pending", s.totalSoFarCents === 1000 + 5670 + 27216 + 700)
  const empty = summaryFor([], today)
  check("summary: nothing yet → no next payout, zeros", empty.nextPayoutDate === null && empty.totalSoFarCents === 0)
}

// ── Mark paid keeps Total so far, moves Next payout on ───────────────────────
{
  const before = summaryFor(
    [
      { status: "pending", amount_cents: 5670, payout_date: "2026-12-15", received_at: "2026-11-20" },
      { status: "pending", amount_cents: 5670, payout_date: "2027-01-15", received_at: "2026-12-20" },
    ],
    "2026-12-15",
  )
  const after = summaryFor(
    [
      { status: "paid", amount_cents: 5670, payout_date: "2026-12-15", received_at: "2026-11-20" },
      { status: "pending", amount_cents: 5670, payout_date: "2027-01-15", received_at: "2026-12-20" },
    ],
    "2026-12-15",
  )
  check("mark paid: total so far unchanged", before.totalSoFarCents === after.totalSoFarCents)
  check("mark paid: moves to Paid", after.paidTotalCents === 5670)
  check("mark paid: next payout moves on to 15 Jan", after.nextPayoutDate === "2027-01-15")
}

// ── Recurring + calculator ───────────────────────────────────────────────────
check("monthly recurring: 2 × $189 at 30% = $113.40", monthlyRecurringCents([18900, 18900], 0.3) === 11340)
check("calculator: 5 × Growth $189 × 35% = $330.75", calculatorCents(189, 5, 0.35) === 33075)
check("calculator: 0 customers = $0", calculatorCents(399, 0, 0.4) === 0)

// ── Full agent view (test checklist §7) ──────────────────────────────────────
{
  const agent = { id: "a1", comp_type: "commission", custom_rate: null }
  const customers: CustomerRow[] = [
    { id: "c1", agent_id: "a1", company_name: "Acme Freight", plan: "growth", billing: "monthly", status: "active", started_at: "2026-11-20" },
    { id: "cx", agent_id: "a2", company_name: "Other agent's", plan: "growth", billing: "monthly", status: "active", started_at: "2026-11-20" },
  ]
  const payments: PaymentRow[] = [{ id: "p1", customer_id: "c1", received_at: "2026-11-20", amount_usd: "189.00", covers: "month" }]
  const entries: EntryRow[] = [
    { id: "e1", agent_id: "a1", customer_id: "c1", payment_id: "p1", kind: "monthly", level: "bronze", rate: "0.3000", base_usd: "189.00", amount_usd: "56.70", payout_date: "2026-12-15", status: "pending" },
    { id: "ex", agent_id: "a2", customer_id: "cx", payment_id: "px", kind: "monthly", level: "bronze", rate: "0.3000", base_usd: "189.00", amount_usd: "56.70", payout_date: "2026-12-15", status: "pending" },
  ]
  const e = buildAgentEarnings(agent, customers, payments, entries, "2026-11-25")
  check("agent view: 1 active customer, Bronze 30%", e.activeCustomers === 1 && e.level.id === "bronze" && e.rate === 0.3)
  check("agent view: Silver: 9 more", e.next?.level.id === "silver" && e.next.needed === 9)
  check("agent view: $56.70 pending, payout 15 Dec", e.summary.pendingCents === 5670 && e.summary.nextPayoutDate === "2026-12-15")
  check("agent view: only their own entries", e.lines.length === 1 && e.lines[0].id === "e1")
  check("agent view: monthly recurring $56.70 from 1 customer", e.monthlyRecurringCents === 5670 && e.monthlyRecurringCustomers === 1)

  // Ten active → Silver; old entry keeps its 30%.
  const ten: CustomerRow[] = Array.from({ length: 10 }, (_, i) => ({ ...customers[0], id: `c${i + 1}` }))
  const e10 = buildAgentEarnings(agent, ten, payments, entries, "2026-11-25")
  check("agent view: 10 active → Silver 35%", e10.level.id === "silver" && e10.rate === 0.35)
  check("agent view: old entries keep their rate", e10.lines[0].rate === 0.3 && e10.lines[0].amountCents === 5670)
  const nine = ten.map((c, i) => (i === 0 ? { ...c, status: "cancelled" } : c))
  check("agent view: cancel one → back to Bronze", buildAgentEarnings(agent, nine, payments, entries, "2026-11-25").level.id === "bronze")

  const custom = buildAgentEarnings({ id: "a1", comp_type: "salary_plus_commission", custom_rate: "0.2000" }, ten, payments, entries, "2026-11-25")
  check("agent view: custom rate replaces the level rate", custom.rate === 0.2 && custom.customRate && custom.salaryPlusCommission)
}

// ── Source wiring ────────────────────────────────────────────────────────────
const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "")
{
  const sql = read("supabase/migrations/20261107000001_agent_earnings.sql")
  check("migration: three tables with RLS on", ["customers", "customer_payments", "commission_entries"].every((t) => sql.includes(`alter table public.${t} enable row level security`)))
  check("migration: agent select only own rows", /customers_select[\s\S]*agent_id = public\.current_agent_id\(\)/.test(sql) && /commission_entries_select[\s\S]*agent_id = public\.current_agent_id\(\)/.test(sql))
  check("migration: writes are admin-only", (sql.match(/with check \(public\.is_admin\(\)\)/g) ?? []).length === 3 && (sql.match(/for update using \(public\.is_admin\(\)\)/g) ?? []).length === 3)
  check("migration: RPCs are service-role only", /revoke all on function public\.record_customer_payment[\s\S]*from public, anon, authenticated/.test(sql) && /revoke all on function public\.cancel_customer[\s\S]*from public, anon, authenticated/.test(sql))
  check("migration: cancel voids scheduled yearly 2nd halves", /kind = 'yearly_second_half'[\s\S]*status = 'scheduled'/.test(sql) && sql.includes("customer left before 6 months"))
  check("migration: agents get comp_type, custom_rate, left_at + guard", ["comp_type", "custom_rate", "left_at", "guard_agent_comp"].every((s) => sql.includes(s)))
}
{
  const cust = read("app/(dashboard)/customers/actions.ts")
  const pay = read("app/(dashboard)/payouts/actions.ts")
  const helper = read("lib/earnings-admin.ts")
  check("actions: admin is checked in the DB (isAdminInDb)", /adminDbOrNull[\s\S]*isAdminInDb\(admin, user\.id\)/.test(helper))
  const guarded = (src: string) => { const fns = src.split("export async function ").slice(1); return fns.length > 0 && fns.every((f) => f.includes("await adminDbOrNull()")) }
  check("actions: every customers action checks admin first", cust.startsWith('"use server"') && guarded(cust))
  check("actions: every payouts action checks admin first", pay.startsWith('"use server"') && guarded(pay))
  check("actions: record payment uses the transactional RPC", cust.includes('rpc("record_customer_payment"'))
  check("actions: cancel uses the RPC", cust.includes('rpc("cancel_customer"'))
  check("actions: adjustment needs a note", /note is required|Add a note/i.test(pay))
  const custPage = read("app/(dashboard)/customers/page.tsx")
  const payPage = read("app/(dashboard)/payouts/page.tsx")
  check("pages: /customers and /payouts redirect non-admins", /role !== "admin"[\s\S]*redirect/.test(custPage) && /role !== "admin"[\s\S]*redirect/.test(payPage))
  const agentsActions = read("app/(dashboard)/agents/actions.ts")
  check("agents: disabling sets left_at", /left_at: active \? null : /.test(agentsActions))
  check("agents: comp control is admin-only", /export async function setAgentComp[\s\S]*requireAdmin/.test(agentsActions))
  const dash = read("app/(dashboard)/dashboard/page.tsx")
  check("home: My earnings only for agents", /role !== "admin" && .*MyEarnings/.test(dash))
  const sidebar = read("components/layout/app-sidebar.tsx")
  check("sidebar: Call script for everyone, Customers + Payouts in the admin block", sidebar.includes('href: "/script"') && /isAdmin && \([\s\S]*"\/customers"[\s\S]*"\/payouts"/.test(sidebar))
  check("sidebar: no leaderboard", !/leaderboard/i.test(sidebar))
}

// ── Call script: demo section ────────────────────────────────────────────────
{
  const demo = CALL_SCRIPT.find((s) => s.id === "demo")
  check("script: demo section exists", !!demo && demo.title === "Demo / Detailed (15-minute call)")
  check("script: demo has 5 steps + 7 objections", demo?.items.length === 12)
  check("script: demo is in the guided order (last)", (GUIDED_ORDER as readonly string[])[GUIDED_ORDER.length - 1] === "demo")
  const page = read("app/(dashboard)/script/page.tsx") + read("app/(dashboard)/script/script-tabs.tsx")
  check("/script: three tabs", ["Quick call", "Normal", "Demo / Detailed"].every((t) => page.includes(t)))
  check("/script: shows goals and caller notes", page.includes("SCRIPT_GOALS") && page.includes("CALLER_NOTES"))
}

console.log(failures ? `\n${failures} FAILED` : "\nAll commission tests passed")
process.exit(failures ? 1 : 0)
