"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { Plus, Search, Users, AlertTriangle } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, Modal, selectClass } from "@/components/earnings/modal"
import { formatDay, formatUsd, PLAN_PRICES, type Covers } from "@/lib/commission"
import { addCustomer, cancelCustomer, recordPayment, searchLeads, type LeadHit } from "./actions"

export interface CustomerView {
  id: string
  agentId: string
  agentName: string
  leadId: string | null
  company: string
  plan: string
  billing: string
  status: string
  startedAt: string
  cancelledAt: string | null
  lastPayment: string | null
  totalCents: number
  overdue: boolean
}

interface AgentOption {
  id: string
  name: string
  active: boolean
}

const PLAN_LABEL: Record<string, string> = { starter: "Starter", growth: "Growth", scale: "Scale", custom: "Custom" }

export function CustomersClient({ customers, agents, today }: { customers: CustomerView[]; agents: AgentOption[]; today: string }) {
  const [addOpen, setAddOpen] = useState(false)
  const [payFor, setPayFor] = useState<CustomerView | null>(null)
  const [cancelFor, setCancelFor] = useState<CustomerView | null>(null)
  const [filter, setFilter] = useState<"active" | "all" | "cancelled">("active")

  const shown = customers.filter((c) => filter === "all" || c.status === filter)
  const activeCount = customers.filter((c) => c.status === "active").length
  const overdueCount = customers.filter((c) => c.overdue).length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Customers</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {activeCount} active · {customers.length} total
            {overdueCount > 0 && <span className="text-amber-700 dark:text-amber-400"> · {overdueCount} payment overdue?</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select className={`${selectClass} w-auto`} value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Show">
            <option value="active">Active</option>
            <option value="cancelled">Cancelled</option>
            <option value="all">All</option>
          </select>
          <Button size="sm" className="gap-2" onClick={() => setAddOpen(true)}>
            <Plus className="size-3.5" />
            Add customer
          </Button>
        </div>
      </div>

      <div className="rounded-lg border bg-card shadow-sm overflow-x-auto">
        {shown.length === 0 ? (
          <div className="py-14 flex flex-col items-center gap-2.5 text-center">
            <div className="size-10 rounded-full bg-muted flex items-center justify-center">
              <Users className="size-4 text-muted-foreground/60" />
            </div>
            <p className="text-sm text-muted-foreground">
              {customers.length === 0 ? 'No customers yet. Click "Add customer" when a sale is paid.' : "No customers in this view."}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="border-b text-xs font-medium text-muted-foreground uppercase tracking-wide text-left">
                <th className="px-4 py-2 font-medium">Company</th>
                <th className="px-3 py-2 font-medium">Agent</th>
                <th className="px-3 py-2 font-medium">Plan</th>
                <th className="px-3 py-2 font-medium">Billing</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Started</th>
                <th className="px-3 py-2 font-medium">Last payment</th>
                <th className="px-3 py-2 font-medium text-right">Total received</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.id} className={`border-b last:border-0 ${c.overdue ? "bg-amber-50/70 dark:bg-amber-950/20" : ""}`}>
                  <td className="px-4 py-2.5 font-medium">
                    {c.leadId ? (
                      <Link href={`/leads/${c.leadId}`} className="hover:underline underline-offset-2">
                        {c.company}
                      </Link>
                    ) : (
                      c.company
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">{c.agentName}</td>
                  <td className="px-3 py-2.5">{PLAN_LABEL[c.plan] ?? c.plan}</td>
                  <td className="px-3 py-2.5 capitalize">{c.billing}</td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                        c.status === "active"
                          ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                          : "bg-muted text-muted-foreground"
                      }`}
                      title={c.cancelledAt ? `Cancelled ${formatDay(c.cancelledAt)}` : undefined}
                    >
                      {c.status === "active" ? "Active" : "Cancelled"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{formatDay(c.startedAt)}</td>
                  <td className="px-3 py-2.5 tabular-nums">
                    <span className="text-muted-foreground">{formatDay(c.lastPayment)}</span>
                    {c.overdue && (
                      <span className="ml-1.5 inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="size-3" aria-hidden />
                        payment overdue?
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-right">{formatUsd(c.totalCents)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-1">
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setPayFor(c)}>
                        Record payment
                      </Button>
                      {c.status === "active" && (
                        <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground hover:text-destructive" onClick={() => setCancelFor(c)}>
                          Cancel
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {addOpen && <AddCustomerModal agents={agents} today={today} onClose={() => setAddOpen(false)} />}
      {payFor && <RecordPaymentModal customer={payFor} today={today} onClose={() => setPayFor(null)} />}
      {cancelFor && <CancelModal customer={cancelFor} today={today} onClose={() => setCancelFor(null)} />}
    </div>
  )
}

function done(result: { error: string | null; note?: string }, ok: string, onClose: () => void, setError: (e: string | null) => void) {
  if (result.error) {
    setError(result.error)
    return
  }
  if (result.note) toast.warning(`${ok}. ${result.note}`)
  else toast.success(ok)
  onClose()
}

function AddCustomerModal({ agents, today, onClose }: { agents: AgentOption[]; today: string; onClose: () => void }) {
  const [agentId, setAgentId] = useState("")
  const [query, setQuery] = useState("")
  const [hits, setHits] = useState<LeadHit[]>([])
  const [lead, setLead] = useState<LeadHit | null>(null)
  const [company, setCompany] = useState("")
  const [plan, setPlan] = useState("growth")
  const [billing, setBilling] = useState<"monthly" | "yearly">("monthly")
  const [startedAt, setStartedAt] = useState(today)
  const [amount, setAmount] = useState("189")
  const [receivedAt, setReceivedAt] = useState(today)
  const [notes, setNotes] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Default amount follows plan + billing (yearly = 12 months − 20%); the admin can change it.
  const suggested = useMemo(() => {
    const p = PLAN_PRICES.find((x) => x.id === plan)
    if (!p) return ""
    return billing === "yearly" ? (Math.round(p.usd * 12 * 0.8 * 100) / 100).toFixed(2) : String(p.usd)
  }, [plan, billing])
  useEffect(() => {
    if (suggested) setAmount(suggested)
  }, [suggested])

  useEffect(() => {
    if (lead || query.trim().length < 2) {
      setHits([])
      return
    }
    const t = setTimeout(async () => {
      const r = await searchLeads(query)
      setHits(r.hits)
    }, 250)
    return () => clearTimeout(t)
  }, [query, lead])

  function pickLead(h: LeadHit) {
    setLead(h)
    setCompany(h.company)
    if (h.agentId && agents.some((a) => a.id === h.agentId)) setAgentId(h.agentId)
    setHits([])
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const r = await addCustomer({
        agentId,
        leadId: lead?.leadId ?? null,
        companyName: company,
        plan,
        billing,
        startedAt,
        amountUsd: amount,
        receivedAt,
        notes,
      })
      done(r, `${company.trim()} added`, onClose, setError)
    })
  }

  return (
    <Modal title="Add customer" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Lead (optional)" htmlFor="cust-lead">
          {lead ? (
            <div className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-sm">
              <span className="truncate">
                {lead.company}
                {lead.mc && <span className="text-muted-foreground"> · MC-{lead.mc}</span>}
              </span>
              <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => { setLead(null); setQuery("") }}>
                Change
              </button>
            </div>
          ) : (
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" aria-hidden />
              <Input
                id="cust-lead"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search company name or MC number"
                className="h-9 pl-8 text-sm"
                autoComplete="off"
              />
              {hits.length > 0 && (
                <ul className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-md max-h-52 overflow-y-auto">
                  {hits.map((h) => (
                    <li key={h.leadId}>
                      <button type="button" className="w-full text-left px-2.5 py-1.5 text-sm hover:bg-muted" onClick={() => pickLead(h)}>
                        {h.company}
                        {h.mc && <span className="text-muted-foreground"> · MC-{h.mc}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Company name" htmlFor="cust-company">
            <Input id="cust-company" value={company} onChange={(e) => setCompany(e.target.value)} required className="h-9 text-sm" />
          </Field>
          <Field label="Agent" htmlFor="cust-agent">
            <select id="cust-agent" className={selectClass} value={agentId} onChange={(e) => setAgentId(e.target.value)} required>
              <option value="">Pick an agent…</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.active ? "" : " (disabled)"}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Plan" htmlFor="cust-plan">
            <select id="cust-plan" className={selectClass} value={plan} onChange={(e) => setPlan(e.target.value)}>
              {PLAN_PRICES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} (${p.usd}/mo)
                </option>
              ))}
              <option value="custom">Custom</option>
            </select>
          </Field>
          <Field label="Billing" htmlFor="cust-billing">
            <select id="cust-billing" className={selectClass} value={billing} onChange={(e) => setBilling(e.target.value as "monthly" | "yearly")}>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </Field>
          <Field label="Start date" htmlFor="cust-start">
            <Input id="cust-start" type="date" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} required className="h-9 text-sm" />
          </Field>
          <div />
          <Field label="First payment (USD)" htmlFor="cust-amount" hint="The full amount received: plan + extra seats + anything else.">
            <Input id="cust-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required className="h-9 text-sm tabular-nums" />
          </Field>
          <Field label="Received on" htmlFor="cust-received" hint="The day the money arrived in the account.">
            <Input id="cust-received" type="date" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} required className="h-9 text-sm" />
          </Field>
        </div>
        <Field label="Notes (optional)" htmlFor="cust-notes">
          <Input id="cust-notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="h-9 text-sm" />
        </Field>

        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={isPending || !agentId || !company.trim()}>
            {isPending ? "Saving…" : "Add customer"}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function RecordPaymentModal({ customer, today, onClose }: { customer: CustomerView; today: string; onClose: () => void }) {
  const [amount, setAmount] = useState("")
  const [receivedAt, setReceivedAt] = useState(today)
  const [covers, setCovers] = useState<Covers>(customer.billing === "yearly" ? "year" : "month")
  const [note, setNote] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const r = await recordPayment({ customerId: customer.id, amountUsd: amount, receivedAt, covers, note })
      done(r, "Payment recorded", onClose, setError)
    })
  }

  return (
    <Modal title={`Record payment — ${customer.company}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {customer.status !== "active" && (
          <p className="rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            This customer is cancelled: the payment is saved but creates no commission.
          </p>
        )}
        <Field label="Amount received (USD)" htmlFor="pay-amount" hint="The full amount: plan + extra seats + anything else.">
          <Input id="pay-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus className="h-9 text-sm tabular-nums" />
        </Field>
        <Field label="Received on" htmlFor="pay-date">
          <Input id="pay-date" type="date" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} required className="h-9 text-sm" />
        </Field>
        <Field label="Covers" htmlFor="pay-covers">
          <select id="pay-covers" className={selectClass} value={covers} onChange={(e) => setCovers(e.target.value as Covers)}>
            <option value="month">One month</option>
            <option value="year">One year (commission split 50/50)</option>
          </select>
        </Field>
        <Field label="Note (optional)" htmlFor="pay-note">
          <Input id="pay-note" value={note} onChange={(e) => setNote(e.target.value)} className="h-9 text-sm" />
        </Field>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={isPending || !amount.trim()}>
            {isPending ? "Saving…" : "Record payment"}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function CancelModal({ customer, today, onClose }: { customer: CustomerView; today: string; onClose: () => void }) {
  const [date, setDate] = useState(today)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function submit() {
    setError(null)
    startTransition(async () => {
      const r = await cancelCustomer(customer.id, date)
      done(r, `${customer.company} cancelled`, onClose, setError)
    })
  }

  return (
    <Modal title={`Cancel ${customer.company}?`} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <ul className="list-disc pl-4 space-y-1 text-muted-foreground">
          <li>{customer.agentName} stops counting this customer for their level.</li>
          <li>Any scheduled yearly 2nd half for this customer is voided.</li>
          <li>Payments and entries already made stay as they are.</li>
        </ul>
        <Field label="Cancelled on" htmlFor="cancel-date">
          <Input id="cancel-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 text-sm" />
        </Field>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Keep customer
          </Button>
          <Button variant="destructive" size="sm" onClick={submit} disabled={isPending}>
            {isPending ? "Cancelling…" : "Cancel customer"}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
