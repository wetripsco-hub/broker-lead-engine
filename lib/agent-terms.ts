// Per-agent commission terms: levels, salary review rule, offer label (pure, no DB).
//
// - Every agent has their own terms (agent_terms). New agents copy the default template.
// - "Active paying customer" = subscription active AND at least one payment received.
//   Trials / customers with no payment yet don't count.
// - Salary review (admin only): all of min_active active paying customers, min_scale on Scale,
//   min_growth on Growth. 50+ without that mix stays on the level's flat rate.

import { LEVELS, type Level } from "@/lib/commission"

export interface TermsLevel {
  name: string
  /** 0.30 = 30% */
  rate: number
  /** Active paying customers needed. The first level is always 0. */
  min: number
  /** Agents at this level see "Eligible for a salary offer review, based on account mix". */
  salary_review: boolean
}

export interface SalaryRule {
  min_active: number
  min_scale: number
  min_growth: number
}

export interface AgentTerms {
  levels: TermsLevel[]
  salary_rule: SalaryRule
  offer_label: string | null
  effective_date: string | null
  notes: string | null
}

/** What the agent is allowed to see of their own terms (no salary rule, no notes). */
export type AgentFacingTerms = Pick<AgentTerms, "levels" | "offer_label" | "effective_date">

export const DEFAULT_SALARY_RULE: SalaryRule = { min_active: 50, min_scale: 10, min_growth: 10 }

/** "Launch offer": Bronze 30% → Silver 35% at 10 → Gold 40% at 25 → Platinum 40% at 50. */
export const LAUNCH_OFFER: AgentTerms = {
  levels: [
    { name: "Bronze", rate: 0.3, min: 0, salary_review: false },
    { name: "Silver", rate: 0.35, min: 10, salary_review: false },
    { name: "Gold", rate: 0.4, min: 25, salary_review: false },
    { name: "Platinum", rate: 0.4, min: 50, salary_review: true },
  ],
  salary_rule: DEFAULT_SALARY_RULE,
  offer_label: "Launch offer – Nov 2026",
  effective_date: null,
  notes: null,
}

export const MAX_LEVELS = 10

// ── Parse / validate ─────────────────────────────────────────────────────────

function int(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) && Number.isInteger(n) && n >= 0 ? n : null
}

function rate(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 && n <= 1 ? Math.round(n * 10000) / 10000 : null
}

/** Checks admin input. Returns the clean terms or a list of problems (in plain words). */
export function validateTerms(input: {
  levels: Array<{ name?: unknown; rate?: unknown; min?: unknown; salary_review?: unknown }>
  salary_rule: { min_active?: unknown; min_scale?: unknown; min_growth?: unknown }
  offer_label?: unknown
  effective_date?: unknown
  notes?: unknown
}): { ok: true; terms: AgentTerms } | { ok: false; errors: string[] } {
  const errors: string[] = []
  const raw = Array.isArray(input.levels) ? input.levels : []
  if (raw.length === 0) errors.push("Add at least one level")
  if (raw.length > MAX_LEVELS) errors.push(`At most ${MAX_LEVELS} levels`)

  const levels: TermsLevel[] = []
  raw.forEach((l, i) => {
    const name = typeof l.name === "string" ? l.name.trim() : ""
    const r = rate(l.rate)
    const m = int(l.min)
    if (!name) errors.push(`Level ${i + 1}: name is required`)
    else if (name.length > 40) errors.push(`Level ${i + 1}: name is too long`)
    if (r === null) errors.push(`${name || `Level ${i + 1}`}: % must be between 0 and 100`)
    if (m === null) errors.push(`${name || `Level ${i + 1}`}: customers must be a whole number, 0 or more`)
    levels.push({ name, rate: r ?? 0, min: m ?? 0, salary_review: l.salary_review === true })
  })
  levels.sort((a, b) => a.min - b.min)
  if (levels.length && levels[0].min !== 0) errors.push("The first level must start at 0 customers")
  for (let i = 1; i < levels.length; i++) {
    if (levels[i].min === levels[i - 1].min) errors.push(`Two levels start at ${levels[i].min} customers`)
  }
  const names = levels.map((l) => l.name.toLowerCase()).filter(Boolean)
  if (new Set(names).size !== names.length) errors.push("Level names must be different")

  const sr = input.salary_rule ?? {}
  const salary_rule = { min_active: int(sr.min_active), min_scale: int(sr.min_scale), min_growth: int(sr.min_growth) }
  if (salary_rule.min_active === null || salary_rule.min_scale === null || salary_rule.min_growth === null) {
    errors.push("Salary rule numbers must be whole numbers, 0 or more")
  }

  const offer_label = typeof input.offer_label === "string" ? input.offer_label.trim().slice(0, 80) || null : null
  const notes = typeof input.notes === "string" ? input.notes.trim().slice(0, 4000) || null : null
  let effective_date: string | null = null
  if (typeof input.effective_date === "string" && input.effective_date) {
    const s = input.effective_date
    const d = new Date(`${s}T00:00:00Z`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
      errors.push("Effective date is not a valid date")
    } else effective_date = s
  }

  if (errors.length) return { ok: false, errors }
  return { ok: true, terms: { levels, salary_rule: salary_rule as SalaryRule, offer_label, effective_date, notes } }
}

/** Levels from a DB row (jsonb); anything unreadable falls back to the Launch offer levels. */
export function parseLevels(raw: unknown): TermsLevel[] {
  if (!Array.isArray(raw) || raw.length === 0) return LAUNCH_OFFER.levels
  const out: TermsLevel[] = []
  for (const l of raw as any[]) {
    const r = rate(l?.rate)
    const m = int(l?.min)
    const name = typeof l?.name === "string" ? l.name.trim() : ""
    if (!name || r === null || m === null) return LAUNCH_OFFER.levels
    out.push({ name, rate: r, min: m, salary_review: l?.salary_review === true })
  }
  out.sort((a, b) => a.min - b.min)
  if (out[0].min !== 0) return LAUNCH_OFFER.levels
  return out
}

export function parseSalaryRule(raw: unknown): SalaryRule {
  const r = (raw ?? {}) as Record<string, unknown>
  const a = int(r.min_active)
  const s = int(r.min_scale)
  const g = int(r.min_growth)
  return a === null || s === null || g === null ? DEFAULT_SALARY_RULE : { min_active: a, min_scale: s, min_growth: g }
}

export function termsFromRow(row: any | null | undefined): AgentTerms {
  if (!row) return { ...LAUNCH_OFFER }
  return {
    levels: parseLevels(row.levels),
    salary_rule: parseSalaryRule(row.salary_rule),
    offer_label: row.offer_label ?? null,
    effective_date: row.effective_date ?? null,
    notes: row.notes ?? null,
  }
}

// ── Levels for the commission engine ────────────────────────────────────────

const EMOJI_BY_NAME: Record<string, string> = { bronze: "🥉", silver: "🥈", gold: "🥇", platinum: "💎" }
const EMOJI_BY_POSITION = ["🥉", "🥈", "🥇", "💎", "🏆", "👑", "🚀", "⭐", "🔥", "🌟"]

export function slugLevel(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30) || "level"
}

/** Terms levels → the Level shape lib/commission.ts works with. */
export function toCommissionLevels(levels: TermsLevel[]): Level[] {
  if (!levels.length) return LEVELS
  return levels.map((l, i) => ({
    id: slugLevel(l.name) as Level["id"],
    name: l.name,
    emoji: EMOJI_BY_NAME[l.name.trim().toLowerCase()] ?? EMOJI_BY_POSITION[i] ?? "⭐",
    min: l.min,
    rate: l.rate,
    salaryOption: l.salary_review,
  }))
}

// ── Counting ─────────────────────────────────────────────────────────────────

export interface PayingCounts {
  total: number
  starter: number
  growth: number
  scale: number
  custom: number
}

/**
 * Active paying customers: status active AND at least one payment received.
 * Trials (no payment yet) and cancelled customers don't count.
 */
export function countActivePaying(
  customers: Array<{ id: string; status: string; plan: string; agent_id?: string }>,
  payments: Array<{ customer_id: string }>,
  agentId?: string,
): PayingCounts {
  const paid = new Set(payments.map((p) => p.customer_id))
  const out: PayingCounts = { total: 0, starter: 0, growth: 0, scale: 0, custom: 0 }
  for (const c of customers) {
    if (agentId && c.agent_id !== agentId) continue
    if (c.status !== "active" || !paid.has(c.id)) continue
    out.total++
    if (c.plan === "starter" || c.plan === "growth" || c.plan === "scale") out[c.plan]++
    else out.custom++
  }
  return out
}

/** Admin only: meets ALL of the salary rule (active, Scale and Growth minimums). */
export function salaryReviewEligible(rule: SalaryRule, counts: PayingCounts): boolean {
  return counts.total >= rule.min_active && counts.scale >= rule.min_scale && counts.growth >= rule.min_growth
}

/** Admin only: what's missing, e.g. ["3 more on Scale"]. Empty when eligible. */
export function salaryReviewGaps(rule: SalaryRule, counts: PayingCounts): string[] {
  const gaps: string[] = []
  if (counts.total < rule.min_active) gaps.push(`${rule.min_active - counts.total} more active`)
  if (counts.scale < rule.min_scale) gaps.push(`${rule.min_scale - counts.scale} more on Scale`)
  if (counts.growth < rule.min_growth) gaps.push(`${rule.min_growth - counts.growth} more on Growth`)
  return gaps
}

export const SALARY_REVIEW_AGENT_TEXT = "Eligible for a salary offer review, based on account mix"
