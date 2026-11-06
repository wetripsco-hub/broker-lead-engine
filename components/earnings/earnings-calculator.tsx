"use client"

import { useState } from "react"
import { Calculator } from "lucide-react"
import { calculatorCents, formatRate, formatUsd, PLAN_PRICES } from "@/lib/commission"

/** "N × $price × your rate = $X every month while they stay" at the agent's current rate. */
export function EarningsCalculator({ rate }: { rate: number }) {
  const [planId, setPlanId] = useState<(typeof PLAN_PRICES)[number]["id"]>("growth")
  const [count, setCount] = useState(5)
  const plan = PLAN_PRICES.find((p) => p.id === planId)!
  const n = Math.max(0, Math.min(999, Math.floor(count || 0)))
  const result = calculatorCents(plan.usd, n, rate)

  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <Calculator className="size-4 text-muted-foreground" aria-hidden />
        Calculator
      </p>
      <p className="text-[11px] text-muted-foreground mt-0.5">An example only, at your current rate. Real earnings come from money received.</p>

      <div className="mt-3 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Plan">
        {PLAN_PRICES.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={planId === p.id}
            onClick={() => setPlanId(p.id)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-[background-color,color,transform] duration-150 ease-[var(--ease-out)] active:scale-[0.97] ${
              planId === p.id ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"
            }`}
          >
            {p.name} ${p.usd}
          </button>
        ))}
      </div>

      <label className="mt-3 flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Customers</span>
        <input
          type="number"
          min={0}
          max={999}
          value={count}
          onChange={(e) => setCount(Number(e.target.value))}
          className="h-8 w-20 rounded-md border border-input bg-transparent px-2 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>

      <p className="mt-3 text-sm tabular-nums">
        {n} × ${plan.usd} × {formatRate(rate)} = <span className="text-lg font-semibold">{formatUsd(result)}</span>{" "}
        <span className="text-muted-foreground">every month while they stay</span>
      </p>
    </div>
  )
}
