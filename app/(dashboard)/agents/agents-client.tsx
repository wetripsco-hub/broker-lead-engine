"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { UserPlus, KeyRound, X, Users, Pencil, Trash2, Award, SlidersHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { toast } from "sonner"
import { useNow } from "@/lib/timezone/use-now"
import { formatPkt, isOnline, timeAgo } from "@/lib/presence"
import { isValidTimezone } from "@/lib/timezone/broker-time"
import { describeLocation } from "@/lib/timezone/viewer-location"
import { formatDay, formatRate, formatUsd } from "@/lib/commission"
import type { AgentTerms, PayingCounts } from "@/lib/agent-terms"
import { TermsEditorModal } from "./terms-editor"
import { createAgent, toggleAgentActive, resetAgentPassword, updateAgent, deleteAgent, setWelcomeTour, setAgentComp } from "./actions"

/** Admin view of one agent's earnings (runbook section 4.3). */
/** Outbound calls the agent made: all time, today (Pakistan time), answered. */
export interface AgentCallCounts {
  total: number
  today: number
  answered: number
}

export interface AgentEarningsBrief {
  /** This agent's own terms (admin only: includes the salary rule and notes). */
  terms: AgentTerms
  hasStoredTerms: boolean
  planCounts: PayingCounts
  /** Meets the salary review rule (active + Scale + Growth). Admin only. */
  salaryEligible: boolean
  salaryGaps: string[]
  levelName: string
  levelEmoji: string
  rate: number
  customRate: boolean
  activeCustomers: number
  thisMonthCents: number
  nextPayoutDate: string | null
  nextPayoutCents: number
  totalSoFarCents: number
  compType: "commission" | "salary_plus_commission"
  customRateValue: number | null
}

interface Agent {
  id: string
  name: string
  email: string | null
  active: boolean
  created_at: string
  /** null = the welcome tour opens on their next sign-in. */
  onboarding_completed_at: string | null
  last_seen_at: string | null
  last_signed_out_at: string | null
  last_sign_in_at: string | null
  /** Where they last connected from (IP), saved by the heartbeat / sign-in. */
  ip_timezone: string | null
  ip_country: string | null
  ip_city: string | null
  ip_location_at: string | null
}

function PresenceLine({ agent, now }: { agent: Agent; now: Date | null }) {
  if (!now) return null
  const online = isOnline(agent.last_seen_at, agent.last_signed_out_at, now)
  const seen = agent.last_seen_at ?? agent.last_sign_in_at
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <span className={`size-1.5 rounded-full ${online ? "bg-green-500" : "bg-muted-foreground/40"}`} aria-hidden />
        <span className={online ? "font-medium text-green-700 dark:text-green-400" : ""}>
          {online ? "Online" : seen ? `Offline · last seen ${timeAgo(seen, now)}` : "Offline · never signed in"}
        </span>
      </span>
      {agent.last_sign_in_at && <span title={agent.last_sign_in_at}>Last login {formatPkt(agent.last_sign_in_at)}</span>}
      {isValidTimezone(agent.ip_timezone) && (
        <span title={agent.ip_timezone}>
          <span aria-hidden>📍 </span>
          {describeLocation({ city: agent.ip_city, country: agent.ip_country, timezone: agent.ip_timezone }, now)}
          {agent.ip_location_at && ` · updated ${timeAgo(agent.ip_location_at, now)}`}
        </span>
      )}
    </p>
  )
}

function EarningsLine({ e, onEdit, onTerms }: { e: AgentEarningsBrief | undefined; onEdit: () => void; onTerms: () => void }) {
  if (!e) return null
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-1 font-medium text-foreground">
        <span aria-hidden>{e.levelEmoji}</span>
        {e.levelName} · {formatRate(e.rate)}
        {e.customRate && <span className="font-normal text-muted-foreground">(custom)</span>}
      </span>
      {e.compType === "salary_plus_commission" && <span className="text-primary">salary + commission</span>}
      <span title={`Active paying: ${e.planCounts.starter} Starter · ${e.planCounts.growth} Growth · ${e.planCounts.scale} Scale${e.planCounts.custom ? ` · ${e.planCounts.custom} custom` : ""}`}>
        {e.activeCustomers} active paying ({e.planCounts.scale} Scale · {e.planCounts.growth} Growth)
      </span>
      <span>this month {formatUsd(e.thisMonthCents)}</span>
      <span>next payout {e.nextPayoutDate ? `${formatUsd(e.nextPayoutCents)} on ${formatDay(e.nextPayoutDate)}` : "—"}</span>
      <span>total so far {formatUsd(e.totalSoFarCents)}</span>
      <button type="button" onClick={onEdit} className="underline underline-offset-2 hover:text-foreground">
        Pay terms
      </button>
      <button type="button" onClick={onTerms} className="underline underline-offset-2 hover:text-foreground">
        Agent terms{e.terms.offer_label ? ` (${e.terms.offer_label})` : ""}
      </button>
    </p>
  )
}

function Stat({ label, value, sub, title }: { label: string; value: number; sub?: string; title?: string }) {
  return (
    <div className="rounded-md border px-2.5 py-1.5" title={title}>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-base font-semibold tabular-nums leading-tight">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground tabular-nums">{sub}</p>}
    </div>
  )
}

export function AgentsClient({
  agents,
  leadCounts,
  callCounts = {},
  earnings = {},
  defaultTerms,
}: {
  agents: Agent[]
  leadCounts: Record<string, number>
  callCounts?: Record<string, AgentCallCounts>
  earnings?: Record<string, AgentEarningsBrief>
  defaultTerms?: AgentTerms
}) {
  const [compFor, setCompFor] = useState<Agent | null>(null)
  const [termsFor, setTermsFor] = useState<Agent | null>(null)
  const [defaultOpen, setDefaultOpen] = useState(false)
  const salaryEligible = agents.filter((a) => earnings[a.id]?.salaryEligible)
  const [addOpen, setAddOpen] = useState(false)
  const [resetFor, setResetFor] = useState<Agent | null>(null)
  const [editFor, setEditFor] = useState<Agent | null>(null)
  const [deleteFor, setDeleteFor] = useState<Agent | null>(null)
  const [isPending, startTransition] = useTransition()
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [tourId, setTourId] = useState<string | null>(null)
  const router = useRouter()
  const now = useNow(30_000)

  // Online / offline changes without a reload.
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 30_000)
    return () => clearInterval(id)
  }, [router])

  const onlineCount = now ? agents.filter((a) => isOnline(a.last_seen_at, a.last_signed_out_at, now)).length : 0

  function handleTour(agent: Agent, show: boolean) {
    setTourId(agent.id)
    startTransition(async () => {
      const { error } = await setWelcomeTour(agent.id, show)
      if (error) toast.error(error)
      else toast.success(show ? `${agent.name} will see the welcome tour on next sign-in` : `Welcome tour turned off for ${agent.name}`)
      setTourId(null)
    })
  }

  function handleToggle(agent: Agent) {
    setTogglingId(agent.id)
    startTransition(async () => {
      const { error } = await toggleAgentActive(agent.id, !agent.active)
      if (error) toast.error(error)
      else toast.success(agent.active ? `${agent.name} disabled` : `${agent.name} enabled`)
      setTogglingId(null)
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {agents.length} total{now && <> · <span className="text-green-700 dark:text-green-400">{onlineCount} online</span></>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {defaultTerms && (
            <Button variant="outline" size="sm" className="gap-2" onClick={() => setDefaultOpen(true)} title="Terms new agents copy when they are created">
              <SlidersHorizontal className="size-3.5" />
              <span className="hidden sm:inline">Default terms</span>
            </Button>
          )}
          <Button size="sm" className="gap-2" onClick={() => setAddOpen(true)}>
            <UserPlus className="size-3.5" />
            Add Agent
          </Button>
        </div>
      </div>

      {/* Admin only: agents who meet their salary review rule */}
      <section aria-labelledby="salary-review" className="rounded-lg border bg-card shadow-sm px-4 py-3">
        <h2 id="salary-review" className="text-sm font-medium flex items-center gap-1.5">
          <Award className="size-4 text-amber-600 dark:text-amber-400" aria-hidden />
          Salary review eligible
          <span className="text-xs font-normal text-muted-foreground">({salaryEligible.length})</span>
        </h2>
        {salaryEligible.length === 0 ? (
          <p className="text-xs text-muted-foreground mt-1">Nobody yet. An agent appears here once they meet their salary review rule (active paying customers plus the Scale / Growth mix).</p>
        ) : (
          <ul className="mt-2 divide-y">
            {salaryEligible.map((a) => {
              const e = earnings[a.id]
              return (
                <li key={a.id} className="py-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm">
                  <span className="font-medium">{a.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {e.activeCustomers} active paying · {e.planCounts.scale} Scale · {e.planCounts.growth} Growth · {e.planCounts.starter} Starter
                  </span>
                  <button type="button" className="ml-auto text-xs underline underline-offset-2 text-muted-foreground hover:text-foreground" onClick={() => setTermsFor(a)}>
                    View terms
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
        {agents.length === 0 ? (
          <div className="py-14 flex flex-col items-center gap-2.5 text-center">
            <div className="size-10 rounded-full bg-muted flex items-center justify-center">
              <Users className="size-4 text-muted-foreground/60" />
            </div>
            <p className="text-sm text-muted-foreground">No agents yet. Click "Add Agent" to create one.</p>
          </div>
        ) : (
          <ul className="divide-y">
            {agents.map((a) => {
              const c = callCounts[a.id] ?? { total: 0, today: 0, answered: 0 }
              const busy = isPending && togglingId === a.id
              return (
                <li key={a.id} className="px-4 py-4 sm:px-5">
                  {/* Name, status and actions */}
                  <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                    <div className="min-w-0 flex-1 basis-48">
                      <div className="flex items-center gap-2">
                        <p className="font-medium truncate">{a.name}</p>
                        <span
                          className={`shrink-0 text-[11px] px-1.5 py-0.5 rounded-full font-medium ${
                            a.active
                              ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {a.active ? "Active" : "Disabled"}
                        </span>
                        {earnings[a.id]?.salaryEligible && (
                          <span className="shrink-0 inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                            <Award className="size-3" aria-hidden />
                            Salary review eligible
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate" title={a.email ?? undefined}>{a.email ?? "—"}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button variant="outline" size="sm" className="h-7 text-xs" disabled={busy} onClick={() => handleToggle(a)}>
                        {busy ? "…" : a.active ? "Disable" : "Enable"}
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5" onClick={() => setResetFor(a)} title="Reset password">
                        <KeyRound className="size-3" />
                        <span className="hidden sm:inline">Reset password</span>
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`Edit ${a.name}`} title="Edit name / email" onClick={() => setEditFor(a)}>
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete ${a.name}`}
                        title="Delete agent"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteFor(a)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>

                  {/* Numbers */}
                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <Stat label="Leads" value={leadCounts[a.id] ?? 0} />
                    <Stat label="Calls" value={c.total} sub={`${c.answered} answered`} title="Outbound calls this agent made" />
                    <Stat label="Calls today" value={c.today} title="Calls today (Pakistan time)" />
                    <label
                      className="rounded-md border px-2.5 py-1.5 flex flex-col justify-center gap-1 cursor-pointer"
                      title="Tick to show the welcome tour the next time this agent signs in. It unticks itself once they finish it."
                    >
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Welcome tour</span>
                      <span className="flex items-center gap-1.5 text-xs">
                        <input
                          type="checkbox"
                          className="size-4 accent-primary cursor-pointer"
                          checked={!a.onboarding_completed_at}
                          disabled={isPending && tourId === a.id}
                          onChange={(e) => handleTour(a, e.target.checked)}
                          aria-label={`Show welcome tour to ${a.name} on next sign-in`}
                        />
                        {a.onboarding_completed_at ? "Off" : "Next login"}
                      </span>
                    </label>
                  </div>

                  {/* Presence and earnings */}
                  <PresenceLine agent={a} now={now} />
                  <EarningsLine e={earnings[a.id]} onEdit={() => setCompFor(a)} onTerms={() => setTermsFor(a)} />
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {compFor && earnings[compFor.id] && (
        <PayTermsModal agent={compFor} earnings={earnings[compFor.id]} onClose={() => setCompFor(null)} />
      )}
      {termsFor && earnings[termsFor.id] && (
        <TermsEditorModal agent={termsFor} terms={earnings[termsFor.id].terms} defaultTerms={defaultTerms} onClose={() => setTermsFor(null)} />
      )}
      {defaultOpen && defaultTerms && <TermsEditorModal terms={defaultTerms} onClose={() => setDefaultOpen(false)} />}
      {addOpen && <AddAgentModal onClose={() => setAddOpen(false)} />}
      {resetFor && <ResetPasswordModal agent={resetFor} onClose={() => setResetFor(null)} />}
      {editFor && <EditAgentModal agent={editFor} onClose={() => setEditFor(null)} />}
      {deleteFor && (
        <DeleteAgentModal agent={deleteFor} leadCount={leadCounts[deleteFor.id] ?? 0} onClose={() => setDeleteFor(null)} />
      )}
    </div>
  )
}

function AddAgentModal({ onClose }: { onClose: () => void }) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(formData: FormData) {
    setError(null)
    startTransition(async () => {
      const result = await createAgent(formData)
      if (result.error) setError(result.error)
      else {
        toast.success("Agent created")
        onClose()
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-card border rounded-xl shadow-xl w-full max-w-sm flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="font-semibold text-sm">Add agent</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
        <form action={handleSubmit} className="px-5 py-4 space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground" htmlFor="agent-name">Name</label>
            <Input id="agent-name" name="name" required className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground" htmlFor="agent-email">Email</label>
            <Input id="agent-email" name="email" type="email" required className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground" htmlFor="agent-password">Password</label>
            <Input id="agent-password" name="password" type="password" minLength={8} required className="h-9 text-sm" />
            <p className="text-[11px] text-muted-foreground">At least 8 characters.</p>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending ? "Creating…" : "Create agent"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ResetPasswordModal({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const [password, setPassword] = useState("")
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleSubmit() {
    setError(null)
    startTransition(async () => {
      const result = await resetAgentPassword(agent.id, password)
      if (result.error) setError(result.error)
      else {
        toast.success(`Password reset for ${agent.name}`)
        onClose()
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-card border rounded-xl shadow-xl w-full max-w-sm flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="font-semibold text-sm">Reset password — {agent.name}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground" htmlFor="new-password">New password</label>
            <Input
              id="new-password"
              type="password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-9 text-sm"
            />
            <p className="text-[11px] text-muted-foreground">At least 8 characters. Share it with the agent directly.</p>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={handleSubmit} disabled={password.length < 8 || isPending}>
              {isPending ? "Saving…" : "Reset password"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function EditAgentModal({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const [name, setName] = useState(agent.name)
  const [email, setEmail] = useState(agent.email ?? "")
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const emailChanged = email.trim().toLowerCase() !== (agent.email ?? "").toLowerCase()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await updateAgent(agent.id, name, email)
      if (result.error) setError(result.error)
      else {
        toast.success(`${name.trim()} updated`)
        onClose()
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-card border rounded-xl shadow-xl w-full max-w-sm flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="font-semibold text-sm">Edit agent</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground" htmlFor="edit-agent-name">Name</label>
            <Input id="edit-agent-name" value={name} onChange={(e) => setName(e.target.value)} required className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground" htmlFor="edit-agent-email">Email (login ID)</label>
            <Input id="edit-agent-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="h-9 text-sm" />
            {emailChanged && (
              <p className="text-[11px] text-amber-700 dark:text-amber-400">
                The agent will sign in with the new email from now on. Their password stays the same.
              </p>
            )}
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button type="submit" size="sm" disabled={isPending || !name.trim() || !email.trim()}>
              {isPending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

function DeleteAgentModal({ agent, leadCount, onClose }: { agent: Agent; leadCount: number; onClose: () => void }) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleDelete() {
    setError(null)
    startTransition(async () => {
      const result = await deleteAgent(agent.id)
      if (result.error) setError(result.error)
      else {
        toast.success(`${agent.name} deleted`)
        onClose()
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-card border rounded-xl shadow-xl w-full max-w-sm flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="font-semibold text-sm">Delete {agent.name}?</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3 text-sm">
          <ul className="list-disc pl-4 space-y-1 text-muted-foreground">
            <li>{agent.email ?? "This agent"} can no longer sign in.</li>
            <li>
              {leadCount > 0
                ? `Their ${leadCount} lead${leadCount === 1 ? "" : "s"} become unassigned — reassign them from Leads.`
                : "They have no assigned leads."}
            </li>
            <li>Past calls, recordings, emails and texts are kept.</li>
          </ul>
          <p className="text-xs text-muted-foreground">This can&apos;t be undone. To pause an agent instead, use Disable.</p>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={handleDelete} disabled={isPending}>
              {isPending ? "Deleting…" : "Delete agent"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Platinum option: salary + commission, and/or a custom commission % that replaces the level %. */
function PayTermsModal({ agent, earnings, onClose }: { agent: Agent; earnings: AgentEarningsBrief; onClose: () => void }) {
  const [compType, setCompType] = useState(earnings.compType)
  const [useCustom, setUseCustom] = useState(earnings.customRateValue !== null)
  const [pct, setPct] = useState(earnings.customRateValue !== null ? String(Math.round(earnings.customRateValue * 10000) / 100) : "40")
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await setAgentComp(agent.id, compType, useCustom ? Number(pct) : null)
      if (result.error) setError(result.error)
      else {
        toast.success(`Pay terms saved for ${agent.name}`)
        onClose()
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-card border rounded-xl shadow-xl w-full max-w-sm flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="font-semibold text-sm">Pay terms — {agent.name}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">
            Now: {earnings.levelEmoji} {earnings.levelName}, {earnings.activeCustomers} active customers, {formatRate(earnings.rate)}.
          </p>
          <div className="space-y-1.5">
            <label className="flex items-center gap-2">
              <input type="radio" className="accent-primary" checked={compType === "commission"} onChange={() => setCompType("commission")} />
              Commission only
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" className="accent-primary" checked={compType === "salary_plus_commission"} onChange={() => setCompType("salary_plus_commission")} />
              <span>
                Salary + commission <span className="text-xs text-muted-foreground">(Platinum option; salary agreed outside the app)</span>
              </span>
            </label>
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="size-4 accent-primary" checked={useCustom} onChange={(e) => setUseCustom(e.target.checked)} />
            Custom commission %
          </label>
          {useCustom && (
            <div className="space-y-1.5">
              <Input inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} className="h-9 text-sm tabular-nums" aria-label="Custom commission percent" />
              <p className="text-[11px] text-muted-foreground">Replaces the level % for new payments. Old entries keep their rate.</p>
            </div>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
