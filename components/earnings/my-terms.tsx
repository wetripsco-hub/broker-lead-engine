// Agent's "My terms" in My Account. Server-rendered from the agent's OWN data only:
// their levels come from my_agent_terms() (never the salary rule or admin notes), their
// customers/payments from RLS-scoped selects. Never shows other agents' terms.

import { createClient } from "@/lib/supabase/server"
import { formatDay, formatRate, todayIn } from "@/lib/commission"
import { SALARY_REVIEW_AGENT_TEXT, toCommissionLevels } from "@/lib/agent-terms"
import { loadMyTerms } from "@/lib/agent-terms-server"
import { buildAgentEarnings, type CustomerRow, type PaymentRow } from "@/lib/earnings"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export async function MyTerms({ userId }: { userId: string }) {
  const supabase = await createClient()
  const { data: agent } = await (supabase.from("agents") as any).select("id, comp_type, custom_rate").eq("user_id", userId).maybeSingle()
  if (!agent) return null

  const [terms, { data: customersRaw }, { data: paymentsRaw }] = await Promise.all([
    loadMyTerms(supabase as any),
    (supabase.from("customers") as any).select("id, agent_id, company_name, plan, billing, status, started_at").eq("agent_id", agent.id),
    (supabase.from("customer_payments") as any).select("id, customer_id, received_at, amount_usd, covers"),
  ])

  const levels = toCommissionLevels(terms.levels)
  const e = buildAgentEarnings(
    { id: agent.id, comp_type: agent.comp_type ?? "commission", custom_rate: agent.custom_rate ?? null },
    (customersRaw ?? []) as CustomerRow[],
    (paymentsRaw ?? []) as PaymentRow[],
    [],
    todayIn(),
    levels,
  )
  const progress = e.next ? Math.min(100, Math.max(0, Math.round(((e.activeCustomers - e.level.min) / (e.next.level.min - e.level.min)) * 100))) : 100

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">My terms</CardTitle>
        <CardDescription>
          {terms.offer_label ?? "Your commission levels"}
          {terms.effective_date && ` · effective ${formatDay(terms.effective_date)}`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="text-3xl leading-none" aria-hidden>
            {e.level.emoji}
          </span>
          <div className="min-w-0">
            <p className="font-semibold leading-tight">{e.level.name}</p>
            <p className="text-xs text-muted-foreground">
              {e.activeCustomers} active paying customer{e.activeCustomers === 1 ? "" : "s"}
            </p>
          </div>
          <div className="ml-auto text-right">
            <p className="text-xl font-semibold tabular-nums leading-none">{formatRate(e.rate)}</p>
            <p className="text-[11px] text-muted-foreground mt-1">{e.customRate ? "your custom rate" : "your commission"}</p>
          </div>
        </div>

        <div>
          <div
            className="h-2 rounded-full bg-muted overflow-hidden"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
            aria-label={e.next ? `Progress to ${e.next.level.name}` : "Top level reached"}
          >
            <div className="h-full rounded-full bg-primary transition-[width] duration-500 ease-[var(--ease-out)]" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-xs mt-1.5">
            {e.next ? (
              <>
                <span className="font-medium">{e.next.level.name}:</span> {e.next.needed} more active paying customer{e.next.needed === 1 ? "" : "s"}
              </>
            ) : (
              "Top level reached"
            )}
          </p>
          {e.level.salaryOption && <p className="text-xs font-medium text-primary mt-1.5">{SALARY_REVIEW_AGENT_TEXT}</p>}
        </div>

        <ul className="space-y-1">
          {levels.map((l, i) => {
            const nextMin = levels[i + 1]?.min
            const current = l.id === e.level.id
            return (
              <li
                key={l.id}
                className={`flex items-center gap-3 rounded-lg px-2.5 py-1.5 text-sm ${current ? "bg-primary/10 ring-1 ring-primary/30" : ""}`}
                aria-current={current ? "true" : undefined}
              >
                <span className="text-base leading-none" aria-hidden>
                  {l.emoji}
                </span>
                <span className="font-medium min-w-20">{l.name}</span>
                <span className="text-muted-foreground tabular-nums text-xs">
                  {nextMin !== undefined ? `${l.min}–${nextMin - 1}` : `${l.min}+`} active
                </span>
                <span className="ml-auto tabular-nums font-medium">{formatRate(l.rate)}</span>
              </li>
            )
          })}
        </ul>
        <p className="text-[11px] text-muted-foreground">
          A customer counts once their first payment is received and while their subscription is active. Trials don&apos;t count.
        </p>
      </CardContent>
    </Card>
  )
}
