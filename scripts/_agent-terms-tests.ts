// Per-agent terms, active paying customers, salary review eligibility.
// Run: npx tsx scripts/_agent-terms-tests.ts
import { readFileSync } from "node:fs"
import {
  LAUNCH_OFFER,
  countActivePaying,
  parseLevels,
  salaryReviewEligible,
  salaryReviewGaps,
  termsFromRow,
  toCommissionLevels,
  validateTerms,
} from "@/lib/agent-terms"
import { levelFor, nextLevel, rateFor } from "@/lib/commission"
import { buildAgentEarnings, type CustomerRow, type PaymentRow } from "@/lib/earnings"

let failures = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : `\n        got ${JSON.stringify(detail)}`}`)
}

const launch = toCommissionLevels(LAUNCH_OFFER.levels)

// ── Launch offer = the old fixed levels ─────────────────────────────────────
check("launch: Bronze 30% at 0", levelFor(0, launch).name === "Bronze" && levelFor(0, launch).rate === 0.3)
check("launch: 9 → Bronze, 10 → Silver 35%", levelFor(9, launch).name === "Bronze" && levelFor(10, launch).rate === 0.35)
check("launch: 25 → Gold 40%", levelFor(25, launch).name === "Gold" && levelFor(25, launch).rate === 0.4)
check("launch: 50 → Platinum, flat 40%", levelFor(50, launch).name === "Platinum" && levelFor(50, launch).rate === 0.4)
check("launch: ids match old ids", launch.map((l) => l.id).join() === "bronze,silver,gold,platinum")
check("launch: only Platinum has salary review", launch.map((l) => !!l.salaryOption).join() === "false,false,false,true")
check("launch: salary rule 50/10/10", JSON.stringify(LAUNCH_OFFER.salary_rule) === '{"min_active":50,"min_scale":10,"min_growth":10}')

// ── Per-agent custom terms ──────────────────────────────────────────────────
const custom = toCommissionLevels([
  { name: "Starter", rate: 0.25, min: 0, salary_review: false },
  { name: "Pro", rate: 0.45, min: 5, salary_review: true },
])
check("custom terms: 4 active → Starter 25%", rateFor({}, 4, custom) === 0.25)
check("custom terms: 5 active → Pro 45%", rateFor({}, 5, custom) === 0.45 && levelFor(5, custom).name === "Pro")
check("custom terms: next from 2 → Pro, 3 more", nextLevel(2, custom)?.level.name === "Pro" && nextLevel(2, custom)?.needed === 3)
check("custom terms: custom_rate still overrides", rateFor({ custom_rate: 0.2 }, 5, custom) === 0.2)

// ── Validation ───────────────────────────────────────────────────────────────
const good = validateTerms({ ...LAUNCH_OFFER, effective_date: "2026-11-09" })
check("validate: launch offer is valid", good.ok)
const bad = validateTerms({
  levels: [
    { name: "A", rate: 0.3, min: 5 },
    { name: "a", rate: 1.5, min: 5 },
  ],
  salary_rule: { min_active: -1, min_scale: 1, min_growth: 1 },
  effective_date: "2026-02-30",
})
check(
  "validate: catches start≠0, duplicate threshold, >100%, duplicate names, bad rule, bad date",
  !bad.ok && bad.errors.length >= 6,
  bad.ok ? null : bad.errors,
)
const unsorted = validateTerms({
  levels: [
    { name: "Gold", rate: 0.4, min: 25 },
    { name: "Bronze", rate: 0.3, min: 0 },
  ],
  salary_rule: { min_active: 50, min_scale: 10, min_growth: 10 },
})
check("validate: sorts levels by threshold", unsorted.ok && unsorted.terms.levels[0].name === "Bronze")
check("parse: junk falls back to launch levels", parseLevels("nope") === LAUNCH_OFFER.levels && parseLevels([{ name: "" }]) === LAUNCH_OFFER.levels)
check("termsFromRow: no row → launch offer", termsFromRow(null).levels.length === 4)

// ── Counting: active PAYING customers ───────────────────────────────────────
let seq = 0
function makeCustomers(agentId: string, mix: { starter?: number; growth?: number; scale?: number }, opts: { paid?: boolean; status?: string } = {}) {
  const customers: CustomerRow[] = []
  const payments: PaymentRow[] = []
  for (const plan of ["starter", "growth", "scale"] as const) {
    for (let i = 0; i < (mix[plan] ?? 0); i++) {
      const id = `c${++seq}`
      customers.push({ id, agent_id: agentId, company_name: `Co ${seq}`, plan, billing: "monthly", status: opts.status ?? "active", started_at: "2026-11-01" })
      if (opts.paid !== false) payments.push({ id: `p${seq}`, customer_id: id, received_at: "2026-11-02", amount_usd: 100, covers: "month" })
    }
  }
  return { customers, payments }
}
function merge(...parts: Array<{ customers: CustomerRow[]; payments: PaymentRow[] }>) {
  return { customers: parts.flatMap((p) => p.customers), payments: parts.flatMap((p) => p.payments) }
}

const trials = merge(makeCustomers("t", { growth: 3 }), makeCustomers("t", { scale: 4 }, { paid: false }))
check("count: trials (no payment) don't count", countActivePaying(trials.customers, trials.payments).total === 3)
const cancelled = merge(makeCustomers("x", { growth: 2 }), makeCustomers("x", { growth: 5 }, { status: "cancelled" }))
check("count: cancelled don't count", countActivePaying(cancelled.customers, cancelled.payments).total === 2)
const mixed = makeCustomers("m", { starter: 1, growth: 2, scale: 3 })
const mc = countActivePaying(mixed.customers, mixed.payments)
check("count: per plan", mc.starter === 1 && mc.growth === 2 && mc.scale === 3 && mc.total === 6, mc)

// ── Sample agents at different levels ───────────────────────────────────────
const rule = LAUNCH_OFFER.salary_rule
const samples: Array<{ name: string; data: ReturnType<typeof merge>; level: string; rate: number; eligible: boolean }> = [
  { name: "Ali (new)", data: merge(), level: "Bronze", rate: 0.3, eligible: false },
  { name: "Sara (4 paying + 6 trials)", data: merge(makeCustomers("s", { growth: 4 }), makeCustomers("s", { growth: 6 }, { paid: false })), level: "Bronze", rate: 0.3, eligible: false },
  { name: "Omar (12)", data: makeCustomers("o", { starter: 6, growth: 6 }), level: "Silver", rate: 0.35, eligible: false },
  { name: "Hina (30)", data: makeCustomers("h", { starter: 10, growth: 10, scale: 10 }), level: "Gold", rate: 0.4, eligible: false },
  { name: "Bilal (55, all Starter)", data: makeCustomers("b", { starter: 55 }), level: "Platinum", rate: 0.4, eligible: false },
  { name: "Zara (50, 9 Scale)", data: makeCustomers("z", { starter: 31, growth: 10, scale: 9 }), level: "Platinum", rate: 0.4, eligible: false },
  { name: "Nadia (50, 10 Scale + 10 Growth)", data: makeCustomers("n", { starter: 30, growth: 10, scale: 10 }), level: "Platinum", rate: 0.4, eligible: true },
  { name: "Usman (49, 20 Scale + 20 Growth)", data: makeCustomers("u", { starter: 9, growth: 20, scale: 20 }), level: "Gold", rate: 0.4, eligible: false },
]
for (const s of samples) {
  const agentId = s.data.customers[0]?.agent_id ?? "none"
  const e = buildAgentEarnings({ id: agentId }, s.data.customers, s.data.payments, [], "2026-11-09", launch)
  const eligible = salaryReviewEligible(rule, e.planCounts)
  check(
    `sample ${s.name}: ${s.level} ${s.rate * 100}%, salary review ${s.eligible ? "yes" : "no"}`,
    e.level.name === s.level && e.rate === s.rate && eligible === s.eligible,
    { level: e.level.name, rate: e.rate, eligible, counts: e.planCounts },
  )
}
const zara = makeCustomers("z2", { starter: 31, growth: 10, scale: 9 })
check("gaps: Zara needs 1 more on Scale", salaryReviewGaps(rule, countActivePaying(zara.customers, zara.payments)).join() === "1 more on Scale")

// Same customers, different terms per agent → different results.
const omar = makeCustomers("o2", { growth: 6 })
const onLaunch = buildAgentEarnings({ id: "o2" }, omar.customers, omar.payments, [], "2026-11-09", launch)
const onCustom = buildAgentEarnings({ id: "o2" }, omar.customers, omar.payments, [], "2026-11-09", custom)
check("per agent: 6 paying → Bronze 30% on Launch, Pro 45% on custom terms", onLaunch.rate === 0.3 && onCustom.rate === 0.45)

// ── The migration: admin-only tables, agent sees levels only ────────────────
const sql = readFileSync("supabase/migrations/20261109000001_agent_terms.sql", "utf8")
check("sql: RLS on both tables", /agent_terms enable row level security/.test(sql) && /commission_templates enable row level security/.test(sql))
check("sql: policies are admin only", (sql.match(/for all using \(public\.is_admin\(\)\)/g) ?? []).length === 2)
const fn = sql.slice(sql.indexOf("create or replace function public.my_agent_terms"))
check("sql: my_agent_terms never returns salary_rule or notes", !/salary_rule|notes/.test(fn.slice(0, fn.indexOf("$$;"))))
check("sql: new agents copy the default via trigger", /after insert on public\.agents/.test(sql) && /where t\.is_default/.test(sql))
check("sql: default is Launch offer 30/35/40/40 at 0/10/25/50", /"rate":0\.30,"min":0/.test(sql) && /"rate":0\.35,"min":10/.test(sql) && /"rate":0\.40,"min":25/.test(sql) && /"rate":0\.40,"min":50/.test(sql))

console.log(failures ? `\n${failures} FAILED` : "\nAll passed")
process.exit(failures ? 1 : 0)
