"use client"

import { useState, useTransition } from "react"
import { ChevronDown, Wallet } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, Modal } from "@/components/earnings/modal"
import { StatusPill } from "@/components/earnings/status-pill"
import { formatDay, formatRate, formatUsd, KIND_LABEL, nextPayoutDay, type EntryKind, type EntryStatus } from "@/lib/commission"
import { addAdjustment, markPaid, overrideEntry, voidEntry } from "./actions"

export interface PayoutEntry {
  id: string
  agentId: string
  agentName: string
  agentLeft: boolean
  company: string
  kind: EntryKind
  level: string
  rate: number
  baseCents: number
  amountCents: number
  receivedAt: string | null
  payoutDate: string
  status: EntryStatus
  storedStatus: EntryStatus
  paidAt: string | null
  paidReference: string | null
  note: string | null
}

interface AgentGroup {
  agentId: string
  agentName: string
  agentLeft: boolean
  entries: PayoutEntry[]
  totalCents: number
}

function groupByDateAndAgent(list: PayoutEntry[]): Array<{ date: string; totalCents: number; agents: AgentGroup[] }> {
  const byDate = new Map<string, Map<string, AgentGroup>>()
  for (const e of list) {
    const agents = byDate.get(e.payoutDate) ?? new Map<string, AgentGroup>()
    const g = agents.get(e.agentId) ?? { agentId: e.agentId, agentName: e.agentName, agentLeft: e.agentLeft, entries: [], totalCents: 0 }
    g.entries.push(e)
    g.totalCents += e.amountCents
    agents.set(e.agentId, g)
    byDate.set(e.payoutDate, agents)
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, agents]) => {
      const list = [...agents.values()].sort((a, b) => a.agentName.localeCompare(b.agentName))
      return { date, agents: list, totalCents: list.reduce((s, g) => s + g.totalCents, 0) }
    })
}

export function PayoutsClient({ entries, today }: { entries: PayoutEntry[]; today: string }) {
  const [payFor, setPayFor] = useState<{ group: AgentGroup; date: string } | null>(null)
  const [editFor, setEditFor] = useState<PayoutEntry | null>(null)
  const [adjustFor, setAdjustFor] = useState<PayoutEntry | null>(null)
  const [voidFor, setVoidFor] = useState<PayoutEntry | null>(null)
  const [showPaid, setShowPaid] = useState(false)

  const pending = groupByDateAndAgent(entries.filter((e) => e.status === "pending"))
  const scheduled = entries.filter((e) => e.status === "scheduled").sort((a, b) => a.payoutDate.localeCompare(b.payoutDate))
  const paid = groupByDateAndAgent(entries.filter((e) => e.status === "paid")).reverse()
  const pendingTotal = pending.reduce((s, d) => s + d.totalCents, 0)
  const scheduledTotal = scheduled.reduce((s, e) => s + e.amountCents, 0)

  const rowActions = { onEdit: setEditFor, onAdjust: setAdjustFor, onVoid: setVoidFor }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Payouts</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Paid on the 15th for money received the month before · next payout day {formatDay(nextPayoutDay(today))}
        </p>
        <p className="text-sm mt-1 tabular-nums">
          <span className="font-medium">{formatUsd(pendingTotal)}</span> <span className="text-muted-foreground">pending</span>
          <span className="text-muted-foreground"> · </span>
          <span className="font-medium">{formatUsd(scheduledTotal)}</span> <span className="text-muted-foreground">scheduled</span>
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">To pay</h2>
        {pending.length === 0 ? (
          <Empty text="Nothing pending. Entries appear here when you record a customer payment." />
        ) : (
          pending.map((d) => (
            <div key={d.date} className="rounded-lg border bg-card shadow-sm overflow-hidden">
              <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b bg-muted/30">
                <p className="text-sm font-semibold">
                  {formatDay(d.date)}
                  {d.date < today && <span className="ml-2 text-xs font-medium text-amber-700 dark:text-amber-400">overdue</span>}
                </p>
                <p className="text-sm font-semibold tabular-nums">{formatUsd(d.totalCents)}</p>
              </div>
              {d.agents.map((g) => (
                <AgentBlock key={g.agentId} group={g} actions={rowActions}>
                  <Button size="sm" className="h-7 text-xs" onClick={() => setPayFor({ group: g, date: d.date })}>
                    Mark paid
                  </Button>
                </AgentBlock>
              ))}
            </div>
          ))
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Upcoming scheduled (yearly 2nd halves)</h2>
        {scheduled.length === 0 ? (
          <Empty text="No scheduled yearly 2nd halves." />
        ) : (
          <div className="rounded-lg border bg-card shadow-sm overflow-x-auto">
            <EntryTable entries={scheduled} showAgent actions={rowActions} />
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Paid only if the customer is still active. Each one moves to “To pay” 31 days before its date; cancelling the customer voids it.
        </p>
      </section>

      <section className="space-y-3">
        <button type="button" className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground" onClick={() => setShowPaid((v) => !v)} aria-expanded={showPaid}>
          <ChevronDown className={`size-4 transition-transform duration-200 ease-[var(--ease-out)] ${showPaid ? "" : "-rotate-90"}`} />
          Paid ({paid.reduce((s, d) => s + d.agents.reduce((n, g) => n + g.entries.length, 0), 0)})
        </button>
        {showPaid &&
          (paid.length === 0 ? (
            <Empty text="Nothing paid yet." />
          ) : (
            paid.map((d) => (
              <div key={d.date} className="rounded-lg border bg-card shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 border-b bg-muted/30">
                  <p className="text-sm font-semibold">{formatDay(d.date)}</p>
                  <p className="text-sm font-semibold tabular-nums">{formatUsd(d.totalCents)}</p>
                </div>
                {d.agents.map((g) => (
                  <AgentBlock key={g.agentId} group={g}>
                    <span className="text-xs text-muted-foreground">Ref: {g.entries[0]?.paidReference ?? "—"}</span>
                  </AgentBlock>
                ))}
              </div>
            ))
          ))}
      </section>

      {payFor && <MarkPaidModal group={payFor.group} date={payFor.date} onClose={() => setPayFor(null)} />}
      {editFor && <OverrideModal entry={editFor} onClose={() => setEditFor(null)} />}
      {adjustFor && <AdjustmentModal entry={adjustFor} today={today} onClose={() => setAdjustFor(null)} />}
      {voidFor && <VoidModal entry={voidFor} onClose={() => setVoidFor(null)} />}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-lg border bg-card py-10 flex flex-col items-center gap-2 text-center">
      <div className="size-9 rounded-full bg-muted flex items-center justify-center">
        <Wallet className="size-4 text-muted-foreground/60" />
      </div>
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  )
}

interface RowActions {
  onEdit: (e: PayoutEntry) => void
  onAdjust: (e: PayoutEntry) => void
  onVoid: (e: PayoutEntry) => void
}

function AgentBlock({ group, actions, children }: { group: AgentGroup; actions?: RowActions; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b last:border-0">
      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 text-sm font-medium min-w-0" aria-expanded={open}>
          <ChevronDown className={`size-3.5 shrink-0 transition-transform duration-200 ease-[var(--ease-out)] ${open ? "" : "-rotate-90"}`} />
          <span className="truncate">{group.agentName}</span>
          {group.agentLeft && <span className="text-[11px] font-normal text-muted-foreground">(left)</span>}
        </button>
        <span className="text-xs text-muted-foreground">
          {group.entries.length} entr{group.entries.length === 1 ? "y" : "ies"}
        </span>
        <span className="ml-auto text-sm font-semibold tabular-nums">{formatUsd(group.totalCents)}</span>
        {children}
      </div>
      {open && (
        <div className="overflow-x-auto border-t bg-muted/10">
          <EntryTable entries={group.entries} actions={actions} />
        </div>
      )}
    </div>
  )
}

function EntryTable({ entries, showAgent, actions }: { entries: PayoutEntry[]; showAgent?: boolean; actions?: RowActions }) {
  return (
    <table className="w-full text-xs min-w-[720px]">
      <thead>
        <tr className="text-left text-muted-foreground uppercase tracking-wide border-b">
          {showAgent && <th className="px-4 py-1.5 font-medium">Agent</th>}
          <th className="px-4 py-1.5 font-medium">Company</th>
          <th className="px-3 py-1.5 font-medium">Kind</th>
          <th className="px-3 py-1.5 font-medium">Received</th>
          <th className="px-3 py-1.5 font-medium">Rate</th>
          <th className="px-3 py-1.5 font-medium text-right">Amount</th>
          <th className="px-3 py-1.5 font-medium">Payout</th>
          <th className="px-3 py-1.5 font-medium">Status</th>
          {actions && <th className="px-4 py-1.5" />}
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => (
          <tr key={e.id} className="border-b last:border-0 align-top">
            {showAgent && <td className="px-4 py-2">{e.agentName}</td>}
            <td className="px-4 py-2">
              <span className="font-medium">{e.company}</span>
              {e.note && <p className="text-muted-foreground mt-0.5">{e.note}</p>}
            </td>
            <td className="px-3 py-2">{KIND_LABEL[e.kind]}</td>
            <td className="px-3 py-2 tabular-nums">{formatDay(e.receivedAt)}</td>
            <td className="px-3 py-2 tabular-nums">{e.kind === "adjustment" ? "—" : `${formatRate(e.rate)}${e.level === "custom" ? " (custom)" : ""}`}</td>
            <td className="px-3 py-2 tabular-nums text-right font-medium">{formatUsd(e.amountCents)}</td>
            <td className="px-3 py-2 tabular-nums">{formatDay(e.payoutDate)}</td>
            <td className="px-3 py-2">
              <StatusPill status={e.status} />
            </td>
            {actions && (
              <td className="px-4 py-1.5">
                <div className="flex justify-end gap-0.5">
                  {e.kind !== "adjustment" && (
                    <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={() => actions.onEdit(e)}>
                      Edit
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={() => actions.onAdjust(e)}>
                    Adjust
                  </Button>
                  <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px] text-muted-foreground hover:text-destructive" onClick={() => actions.onVoid(e)}>
                    Void
                  </Button>
                </div>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function useSubmit(onClose: () => void) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  function run(fn: () => Promise<{ error: string | null; note?: string }>, ok: string) {
    setError(null)
    startTransition(async () => {
      const r = await fn()
      if (r.error) setError(r.error)
      else {
        toast.success(r.note ? `${ok}. ${r.note}` : ok)
        onClose()
      }
    })
  }
  return { error, isPending, run }
}

function MarkPaidModal({ group, date, onClose }: { group: AgentGroup; date: string; onClose: () => void }) {
  const [reference, setReference] = useState("")
  const { error, isPending, run } = useSubmit(onClose)
  return (
    <Modal title={`Mark paid — ${group.agentName}`} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          run(() => markPaid(group.agentId, date, reference), `${group.agentName} marked paid`)
        }}
      >
        <p className="text-sm">
          <span className="font-semibold tabular-nums">{formatUsd(group.totalCents)}</span>{" "}
          <span className="text-muted-foreground">
            · {group.entries.length} entr{group.entries.length === 1 ? "y" : "ies"} · payout {formatDay(date)}
          </span>
        </p>
        <Field label="Payment reference" htmlFor="paid-ref" hint="e.g. the Wise, Payoneer or bank transfer reference.">
          <Input id="paid-ref" value={reference} onChange={(e) => setReference(e.target.value)} required autoFocus className="h-9 text-sm" />
        </Field>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={isPending || !reference.trim()}>
            {isPending ? "Saving…" : "Mark paid"}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function OverrideModal({ entry, onClose }: { entry: PayoutEntry; onClose: () => void }) {
  const [mode, setMode] = useState<"rate" | "amount">("rate")
  const [rate, setRate] = useState(String(Math.round(entry.rate * 10000) / 100))
  const [amount, setAmount] = useState((entry.amountCents / 100).toFixed(2))
  const [note, setNote] = useState("")
  const { error, isPending, run } = useSubmit(onClose)
  return (
    <Modal title={`Edit entry — ${entry.company}`} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          run(
            () => overrideEntry(entry.id, mode === "rate" ? { ratePct: Number(rate) } : { amountUsd: amount }, note),
            "Entry updated",
          )
        }}
      >
        <p className="text-xs text-muted-foreground">
          {KIND_LABEL[entry.kind]} · base {formatUsd(entry.baseCents)} · now {formatRate(entry.rate)} = {formatUsd(entry.amountCents)}
        </p>
        <div className="flex gap-3 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={mode === "rate"} onChange={() => setMode("rate")} className="accent-primary" /> Change rate
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={mode === "amount"} onChange={() => setMode("amount")} className="accent-primary" /> Change amount
          </label>
        </div>
        {mode === "rate" ? (
          <Field label="Rate (%)" htmlFor="ov-rate" hint="The amount is recalculated from the base.">
            <Input id="ov-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} className="h-9 text-sm tabular-nums" />
          </Field>
        ) : (
          <Field label="Amount (USD)" htmlFor="ov-amount">
            <Input id="ov-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-9 text-sm tabular-nums" />
          </Field>
        )}
        <Field label="Note (required)" htmlFor="ov-note">
          <Input id="ov-note" value={note} onChange={(e) => setNote(e.target.value)} required className="h-9 text-sm" />
        </Field>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={isPending || !note.trim()}>
            {isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function AdjustmentModal({ entry, today, onClose }: { entry: PayoutEntry; today: string; onClose: () => void }) {
  const [amount, setAmount] = useState("")
  const [date, setDate] = useState(nextPayoutDay(today))
  const [note, setNote] = useState("")
  const { error, isPending, run } = useSubmit(onClose)
  return (
    <Modal title={`Adjustment — ${entry.agentName}`} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          run(() => addAdjustment(entry.id, amount, date, note), "Adjustment added")
        }}
      >
        <p className="text-xs text-muted-foreground">Linked to {entry.company}&apos;s payment of {formatDay(entry.receivedAt)}.</p>
        <Field label="Amount (USD)" htmlFor="adj-amount" hint="Use a minus sign to deduct, e.g. -25.">
          <Input id="adj-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus className="h-9 text-sm tabular-nums" />
        </Field>
        <Field label="Payout date (a 15th)" htmlFor="adj-date">
          <Input id="adj-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 text-sm" />
        </Field>
        <Field label="Note (required)" htmlFor="adj-note">
          <Input id="adj-note" value={note} onChange={(e) => setNote(e.target.value)} required className="h-9 text-sm" />
        </Field>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={isPending || !amount.trim() || !note.trim()}>
            {isPending ? "Saving…" : "Add adjustment"}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function VoidModal({ entry, onClose }: { entry: PayoutEntry; onClose: () => void }) {
  const [note, setNote] = useState("")
  const { error, isPending, run } = useSubmit(onClose)
  return (
    <Modal title={`Void entry — ${entry.company}?`} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          run(() => voidEntry(entry.id, note), "Entry voided")
        }}
      >
        <p className="text-sm">
          {KIND_LABEL[entry.kind]} · <span className="font-medium tabular-nums">{formatUsd(entry.amountCents)}</span> for {entry.agentName}
        </p>
        <Field label="Why? (required)" htmlFor="void-note">
          <Input id="void-note" value={note} onChange={(e) => setNote(e.target.value)} required autoFocus className="h-9 text-sm" />
        </Field>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="destructive" size="sm" disabled={isPending || !note.trim()}>
            {isPending ? "Voiding…" : "Void entry"}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
