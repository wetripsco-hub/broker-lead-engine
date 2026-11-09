"use client"

import { useState, useTransition } from "react"
import { Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field, Modal } from "@/components/earnings/modal"
import { MAX_LEVELS, type AgentTerms } from "@/lib/agent-terms"
import { saveAgentTerms, saveDefaultTerms, type TermsInput } from "./actions"

type Row = { key: number; name: string; pct: string; min: string; salary_review: boolean }

let keySeq = 0
function rowsFrom(terms: AgentTerms): Row[] {
  return terms.levels.map((l) => ({
    key: ++keySeq,
    name: l.name,
    pct: String(Math.round(l.rate * 10000) / 100),
    min: String(l.min),
    salary_review: l.salary_review,
  }))
}

/**
 * Admin editor for one agent's terms, or (agent omitted) the default template that
 * new agents copy. Saving the default never changes existing agents.
 */
export function TermsEditorModal({
  agent,
  terms,
  defaultTerms,
  onClose,
}: {
  agent?: { id: string; name: string }
  terms: AgentTerms
  /** Offered as "Copy from default" when editing one agent. */
  defaultTerms?: AgentTerms
  onClose: () => void
}) {
  const today = new Date().toISOString().slice(0, 10)
  const [rows, setRows] = useState<Row[]>(() => rowsFrom(terms))
  const [offer, setOffer] = useState(terms.offer_label ?? "")
  const [date, setDate] = useState(terms.effective_date ?? today)
  const [notes, setNotes] = useState(terms.notes ?? "")
  const [minActive, setMinActive] = useState(String(terms.salary_rule.min_active))
  const [minScale, setMinScale] = useState(String(terms.salary_rule.min_scale))
  const [minGrowth, setMinGrowth] = useState(String(terms.salary_rule.min_growth))
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function set(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }

  function copyDefault() {
    if (!defaultTerms) return
    setRows(rowsFrom(defaultTerms))
    setOffer(defaultTerms.offer_label ?? "")
    setMinActive(String(defaultTerms.salary_rule.min_active))
    setMinScale(String(defaultTerms.salary_rule.min_scale))
    setMinGrowth(String(defaultTerms.salary_rule.min_growth))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const input: TermsInput = {
      levels: rows.map((r) => ({ name: r.name, ratePct: r.pct.trim() === "" ? NaN : Number(r.pct), min: r.min.trim() === "" ? NaN : Number(r.min), salary_review: r.salary_review })),
      salary_rule: { min_active: Number(minActive), min_scale: Number(minScale), min_growth: Number(minGrowth) },
      offer_label: offer,
      effective_date: date,
      notes,
    }
    startTransition(async () => {
      const result = agent ? await saveAgentTerms(agent.id, input) : await saveDefaultTerms(input)
      if (result.error) setError(result.error)
      else {
        toast.success(agent ? `Terms saved for ${agent.name}` : "Default terms saved. Existing agents keep theirs.")
        onClose()
      }
    })
  }

  return (
    <Modal title={agent ? `Agent terms — ${agent.name}` : "Default terms (new agents)"} onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="space-y-4 text-sm">
        <p className="text-xs text-muted-foreground">
          {agent
            ? "Applies to payments recorded from now on. Past entries keep their rate."
            : "New agents copy these terms when they are created. Changing them never changes existing agents."}
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Offer label" htmlFor="terms-offer">
            <Input id="terms-offer" value={offer} onChange={(e) => setOffer(e.target.value)} placeholder="Launch offer – Nov 2026" className="h-9 text-sm" maxLength={80} />
          </Field>
          {agent && (
            <Field label="Effective date" htmlFor="terms-date">
              <Input id="terms-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 text-sm" />
            </Field>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium">Commission levels</p>
            {agent && defaultTerms && (
              <button type="button" onClick={copyDefault} className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground">
                Copy from default
              </button>
            )}
          </div>
          <div className="hidden sm:grid grid-cols-[1fr_72px_96px_68px_28px] gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
            <span>Name</span>
            <span>%</span>
            <span>From (active)</span>
            <span title="Agents at this level see “Eligible for a salary offer review, based on account mix”">Salary msg</span>
            <span />
          </div>
          {rows.map((r, i) => (
            <div key={r.key} className="grid grid-cols-2 sm:grid-cols-[1fr_72px_96px_68px_28px] gap-2 items-end sm:items-center rounded-md border p-2 sm:border-0 sm:p-0">
              <label className="col-span-2 sm:col-span-1 space-y-1">
                <span className="text-[11px] text-muted-foreground sm:sr-only">Name</span>
                <Input aria-label={`Level ${i + 1} name`} value={r.name} onChange={(e) => set(i, { name: e.target.value })} className="h-8 text-sm" maxLength={40} />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] text-muted-foreground sm:sr-only">Commission %</span>
                <Input aria-label={`${r.name || `Level ${i + 1}`} percent`} inputMode="decimal" value={r.pct} onChange={(e) => set(i, { pct: e.target.value })} className="h-8 text-sm tabular-nums" />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] text-muted-foreground sm:sr-only">From (active paying)</span>
                <Input
                  aria-label={`${r.name || `Level ${i + 1}`} active customers needed`}
                  inputMode="numeric"
                  value={r.min}
                  onChange={(e) => set(i, { min: e.target.value })}
                  className="h-8 text-sm tabular-nums"
                />
              </label>
              <label className="flex items-center gap-1.5 text-xs sm:col-span-1">
                <input type="checkbox" className="size-4 accent-primary" checked={r.salary_review} onChange={(e) => set(i, { salary_review: e.target.checked })} />
                <span className="sm:sr-only">Show salary review message</span>
              </label>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${r.name || `level ${i + 1}`}`}
                disabled={rows.length <= 1}
                onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                className="justify-self-end text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
          {rows.length < MAX_LEVELS && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => setRows((rs) => [...rs, { key: ++keySeq, name: "", pct: rs.at(-1)?.pct ?? "30", min: String((Number(rs.at(-1)?.min) || 0) + 10), salary_review: false }])}
            >
              <Plus className="size-3" /> Add level
            </Button>
          )}
          <p className="text-[11px] text-muted-foreground">Level = active paying customers (first payment received, subscription active). Trials don&apos;t count. The first level starts at 0.</p>
        </div>

        <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
          <p className="text-xs font-medium">Salary review rule <span className="font-normal text-muted-foreground">(admin only — agents never see this)</span></p>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Active paying ≥" htmlFor="sr-active">
              <Input id="sr-active" inputMode="numeric" value={minActive} onChange={(e) => setMinActive(e.target.value)} className="h-8 text-sm tabular-nums" />
            </Field>
            <Field label="On Scale ($799) ≥" htmlFor="sr-scale">
              <Input id="sr-scale" inputMode="numeric" value={minScale} onChange={(e) => setMinScale(e.target.value)} className="h-8 text-sm tabular-nums" />
            </Field>
            <Field label="On Growth ($189) ≥" htmlFor="sr-growth">
              <Input id="sr-growth" inputMode="numeric" value={minGrowth} onChange={(e) => setMinGrowth(e.target.value)} className="h-8 text-sm tabular-nums" />
            </Field>
          </div>
          <p className="text-[11px] text-muted-foreground">All three must be met. Without the mix the agent stays on their level&apos;s flat %.</p>
        </div>

        <Field label="Notes (admin only)" htmlFor="terms-notes">
          <Textarea id="terms-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="text-sm" maxLength={4000} />
        </Field>

        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? "Saving…" : "Save terms"}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
