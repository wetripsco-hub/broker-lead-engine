"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { StageBadge } from "@/components/leads/stage-badge"
import { StageSelector } from "@/components/leads/stage-selector"
import { AssignedAgentSelector } from "@/components/leads/assigned-agent-selector"
import { BulkEmailModal, type BulkRecipient } from "@/components/leads/bulk-email-modal"
import { ExportMenu } from "@/components/leads/export-menu"
import { AiCallQueueModal } from "@/components/leads/ai-call-queue-modal"
import { FavoriteButton } from "@/components/leads/favorite-button"
import { Search, ChevronRight, Mail, X, ArrowDown, ArrowUp, Clock, Bot, Star } from "lucide-react"
import { toast } from "sonner"
import { CallDot, describeCall, type CallDisplayState } from "@/components/leads/call-status"
import { useNow } from "@/lib/timezone/use-now"
import {
  resolveTimezone,
  getCallStatus,
  formatLocalClock,
  formatLocalTime,
  type CallStatus,
} from "@/lib/timezone/broker-time"
import { bulkAssignLeads } from "./actions"
import type { FollowUpInfo } from "@/lib/follow-up/compute"
import type { LeadStage } from "@/types/database"

interface LeadRow {
  id: string
  stage: LeadStage
  assigned_agent_id: string | null
  created_at: string
  brokers: {
    // Newly scraped brokers can have no MC number yet (only a DOT).
    mc_number: string | null
    dot_number: string | null
    // 'active' | 'pending' | 'withdrawn' | 'inactive' | null (not looked up yet)
    mc_status: string | null
    company_name: string
    contact_name: string | null
    city: string | null
    state: string | null
    phone: string | null
    email: string | null
  } | null
  agents: { name: string } | null
}

interface Template {
  id: string
  name: string
  subject: string
  body: string
  type?: "initial" | "follow_up"
}

interface EmailStatusInfo {
  status: string
  openCount: number
  clickCount: number
}

// Mirrors OutreachTimeline's STATUS_BADGE: Sent (gray) -> Delivered (blue)
// -> Opened (green) -> Clicked (purple).
const EMAIL_STATUS_BADGE: Record<string, string> = {
  pending:   "bg-muted text-muted-foreground",
  sent:      "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200",
  delivered: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  opened:    "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  clicked:   "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  failed:    "bg-destructive/10 text-destructive",
}

const EMAIL_STATUS_LABEL: Record<string, string> = {
  pending:   "Pending",
  sent:      "Sent",
  delivered: "Delivered",
  opened:    "Opened",
  clicked:   "Clicked",
  failed:    "Failed",
}

function EmailStatusCell({ info }: { info: EmailStatusInfo | undefined }) {
  if (!info) return <span className="text-xs text-muted-foreground pointer-events-none">—</span>
  return (
    <span
      className={`text-xs px-1.5 py-0.5 rounded-full font-medium w-fit pointer-events-none ${
        EMAIL_STATUS_BADGE[info.status] ?? "bg-muted text-muted-foreground"
      }`}
    >
      {EMAIL_STATUS_LABEL[info.status] ?? info.status}
    </span>
  )
}

// The agent view has no Agent column, so it needs its own track list — a
// fixed template with one column too many pushes everything after it over.
const GRID_ADMIN = "grid-cols-[28px_1fr_140px_100px_110px_110px_180px_100px_32px]"
const GRID_AGENT = "grid-cols-[28px_1fr_140px_100px_110px_110px_100px_32px]"

function relativeAge(iso: string, now: number): string {
  const mins = Math.floor((now - new Date(iso).getTime()) / 60_000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// "Callable now first": green, then amber, then closed, then weekend, then
// leads whose timezone we couldn't work out.
function LastEmailCell({ info }: { info: FollowUpInfo | undefined }) {
  // Never emailed: show nothing.
  if (!info) return <span />
  return (
    <div className="min-w-0 pointer-events-none leading-tight">
      <p className="text-sm text-muted-foreground tabular-nums">
        {info.days === 0 ? "Today" : `${info.days}d ago`}
      </p>
      <p
        className={`text-xs h-4 ${
          info.replied ? "text-green-600 dark:text-green-400" : "text-muted-foreground/70"
        }`}
      >
        {info.replied ? "Replied" : "No reply"}
      </p>
    </div>
  )
}

const CALL_RANK: Record<CallDisplayState, number> = { ok: 0, closing: 1, closed: 2, weekend: 3, unknown: 4 }

// MC status as stored by the scraper (lower-case). "unknown" = no status yet.
const MC_FILTERS: { value: string; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "pending", label: "Pending" },
  { value: "withdrawn", label: "Withdrawn" },
  { value: "inactive", label: "Inactive" },
  { value: "unknown", label: "Unknown" },
]
const mcKey = (s: string | null | undefined) => (s ? s.trim().toLowerCase() : "unknown")

const STAGE_FILTERS: { value: LeadStage | "all"; label: string }[] = [
  { value: "all",        label: "All" },
  { value: "new",        label: "New" },
  { value: "contacted",  label: "Contacted" },
  { value: "interested", label: "Interested" },
  { value: "converted",  label: "Converted" },
  { value: "dead",       label: "Dead" },
]

export function LeadsListClient({
  leads,
  isAdmin,
  templates,
  currentAgentName,
  emailStatusByLead,
  allAgents,
  followUpByLead,
  favoriteIds,
  initialFollowUpOnly,
}: {
  leads: LeadRow[]
  isAdmin: boolean
  templates: Template[]
  currentAgentName: string
  emailStatusByLead: Record<string, EmailStatusInfo>
  allAgents: Array<{ id: string; name: string }>
  followUpByLead: Record<string, FollowUpInfo>
  favoriteIds: string[]
  initialFollowUpOnly: boolean
}) {
  const [stageFilter, setStageFilter] = useState<LeadStage | "all">("all")
  const [agentFilter, setAgentFilter] = useState<string>("all") // "all" | "unassigned" | agentId
  const [mcFilter, setMcFilter] = useState<string>("all") // "all" | "active" | "pending" | ...
  const [search, setSearch] = useState("")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkModalOpen, setBulkModalOpen] = useState(false)
  const [aiQueueOpen, setAiQueueOpen] = useState(false)
  const [isAssigning, setIsAssigning] = useState(false)
  // Newest first by default: the freshly scraped leads are what you look for.
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc")
  const [sortMode, setSortMode] = useState<"date" | "callable" | "followup" | "favorites">("date")
  const [callableOnly, setCallableOnly] = useState(false)
  const [followUpOnly, setFollowUpOnly] = useState(initialFollowUpOnly)
  // The signed-in user's stars (personal). Updated instantly when a star is clicked.
  const [favorites, setFavorites] = useState<Set<string>>(() => new Set(favoriteIds))
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const setFavorite = (id: string, on: boolean) =>
    setFavorites((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  // Relative ages and local times depend on the current time, so they're
  // filled in after mount (null until then) — rendering them on the server
  // would mismatch on hydration. A 30s tick is plenty: nothing here shows
  // seconds, and the calling window only changes on minute boundaries.
  const nowDate = useNow(30_000)
  const now = nowDate ? nowDate.getTime() : null

  // Timezone per lead never changes; the calling status does, with the clock.
  const tzByLead = useMemo(
    () => new Map(leads.map((l) => [l.id, resolveTimezone(l.brokers?.state, l.brokers?.phone)])),
    [leads],
  )
  const callByLead = useMemo(() => {
    if (!nowDate) return null
    const map = new Map<string, { status: CallStatus; clock: string; title: string } | null>()
    for (const [id, tz] of tzByLead) {
      if (!tz) {
        map.set(id, null)
        continue
      }
      const status = getCallStatus(tz.tz, nowDate)
      const { headline } = describeCall(status, nowDate)
      map.set(id, {
        status,
        clock: formatLocalClock(tz.tz, nowDate),
        title: `${headline} · ${formatLocalTime(tz.tz, nowDate)} · ${tz.zoneLabel}${tz.place ? ` (${tz.place})` : ""}`,
      })
    }
    return map
  }, [tzByLead, nowDate])

  const mcCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of leads) m.set(mcKey(l.brokers?.mc_status), (m.get(mcKey(l.brokers?.mc_status)) ?? 0) + 1)
    return m
  }, [leads])

  const favoriteCount = leads.filter((l) => favorites.has(l.id)).length

  const followUpCount = leads.filter((l) => followUpByLead[l.id]?.due).length

  const callableCount = callByLead
    ? leads.filter((l) => callByLead.get(l.id)?.status.state === "ok").length
    : null

  const matching = leads.filter((l) => {
    if (stageFilter !== "all" && l.stage !== stageFilter) return false
    // "Callable now" = green only (inside the window, not about to close).
    if (followUpOnly && !followUpByLead[l.id]?.due) return false
    if (favoritesOnly && !favorites.has(l.id)) return false
    if (callableOnly && callByLead?.get(l.id)?.status.state !== "ok") return false
    if (mcFilter !== "all" && mcKey(l.brokers?.mc_status) !== mcFilter) return false
    if (agentFilter === "unassigned" && l.assigned_agent_id !== null) return false
    if (agentFilter !== "all" && agentFilter !== "unassigned" && l.assigned_agent_id !== agentFilter) return false
    if (search) {
      const q = search.toLowerCase()
      const b = l.brokers
      if (!b) return false
      return (
        b.company_name.toLowerCase().includes(q) ||
        b.mc_number?.includes(q) ||
        b.dot_number?.includes(q) ||
        b.state?.toLowerCase().includes(q) ||
        b.city?.toLowerCase().includes(q) ||
        false
      )
    }
    return true
  })

  const filtered = [...matching].sort((a, b) => {
    if (sortMode === "favorites") {
      const d = Number(favorites.has(b.id)) - Number(favorites.has(a.id))
      return d !== 0 ? d : b.created_at.localeCompare(a.created_at) // newest first within each group
    }
    if (sortMode === "followup") {
      // Most overdue first; leads with nothing due fall to the bottom.
      const da = followUpByLead[a.id]?.due ? followUpByLead[a.id].days : -1
      const db = followUpByLead[b.id]?.due ? followUpByLead[b.id].days : -1
      if (da !== db) return db - da
      return b.created_at.localeCompare(a.created_at)
    }
    if (sortMode === "callable" && callByLead) {
      const rank = (id: string) => CALL_RANK[callByLead.get(id)?.status.state ?? "unknown"]
      const r = rank(a.id) - rank(b.id)
      if (r !== 0) return r
      return b.created_at.localeCompare(a.created_at) // newest first within a group
    }
    const d = a.created_at.localeCompare(b.created_at)
    return sortDir === "desc" ? -d : d
  })

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAll() {
    setSelectedIds(new Set(filtered.map((l) => l.id)))
  }

  function deselectAll() {
    setSelectedIds(new Set())
  }

  const selectedRecipients: BulkRecipient[] = useMemo(
    () =>
      leads
        .filter((l) => selectedIds.has(l.id))
        .map((l) => ({
          leadId: l.id,
          companyName: l.brokers?.company_name ?? "Unknown broker",
          contactName: l.brokers?.contact_name ?? null,
          mcNumber: l.brokers?.mc_number ?? "",
          state: l.brokers?.state ?? null,
          city: l.brokers?.city ?? null,
          email: l.brokers?.email ?? null,
        })),
    [leads, selectedIds]
  )

  const allFilteredSelected = filtered.length > 0 && filtered.every((l) => selectedIds.has(l.id))

  return (
    <div className="space-y-4 pb-20">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {leads.length} total · {filtered.length} shown
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            placeholder="Search company, MC, state…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 w-64 text-sm"
          />
        </div>
        <div className="flex items-center gap-1">
          {STAGE_FILTERS.map((f) => (
            <Button
              key={f.value}
              variant={stageFilter === f.value ? "default" : "ghost"}
              size="sm"
              className="h-8 text-xs px-3"
              onClick={() => setStageFilter(f.value)}
            >
              {f.label}
            </Button>
          ))}
        </div>
        <select
          value={mcFilter}
          onChange={(e) => setMcFilter(e.target.value)}
          aria-label="Filter by MC status"
          className="h-8 rounded-md border border-input bg-transparent px-2 text-xs outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="all">All MC statuses</option>
          {MC_FILTERS.filter((f) => (mcCounts.get(f.value) ?? 0) > 0 || f.value === mcFilter).map((f) => (
            <option key={f.value} value={f.value}>
              MC {f.label} ({mcCounts.get(f.value) ?? 0})
            </option>
          ))}
        </select>
        {isAdmin && (
          <select
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            className="h-8 rounded-md border border-input bg-transparent px-2 text-xs outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="all">All agents</option>
            <option value="unassigned">Unassigned</option>
            {allAgents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        )}
        <button
          type="button"
          aria-pressed={callableOnly}
          disabled={now === null}
          onClick={() => setCallableOnly((v) => !v)}
          title="Only leads whose local time is inside the calling window"
          className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-[background-color,color,border-color,transform] duration-150 ease-[var(--ease-out)] active:scale-[0.97] disabled:opacity-50 ${
            callableOnly
              ? "border-green-300 bg-green-100 text-green-700 dark:border-green-800 dark:bg-green-900/40 dark:text-green-300"
              : "border-input hover:bg-muted"
          }`}
        >
          <CallDot state="ok" />
          Callable now{callableCount !== null ? ` (${callableCount})` : ""}
        </button>
        <button
          type="button"
          aria-pressed={favoritesOnly}
          onClick={() => setFavoritesOnly((v) => !v)}
          title="Only the leads you have starred"
          className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-[background-color,color,border-color,transform] duration-150 ease-[var(--ease-out)] active:scale-[0.97] ${
            favoritesOnly
              ? "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
              : "border-input hover:bg-muted"
          }`}
        >
          <Star className={`size-3.5 ${favoritesOnly ? "fill-amber-400 text-amber-500" : ""}`} />
          Favorites ({favoriteCount})
        </button>
        <button
          type="button"
          aria-pressed={followUpOnly}
          onClick={() => setFollowUpOnly((v) => !v)}
          title="Emailed with no reply yet"
          className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-[background-color,color,border-color,transform] duration-150 ease-[var(--ease-out)] active:scale-[0.97] ${
            followUpOnly
              ? "border-orange-300 bg-orange-100 text-orange-700 dark:border-orange-800 dark:bg-orange-900/40 dark:text-orange-300"
              : "border-input hover:bg-muted"
          }`}
        >
          <Clock className="size-3.5" />
          Follow-up ({followUpCount})
        </button>
        <select
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as "date" | "callable" | "followup" | "favorites")}
          className="h-8 rounded-md border border-input bg-transparent px-2 text-xs outline-none focus:ring-2 focus:ring-ring"
          aria-label="Sort leads"
        >
          <option value="date">Sort: Date added</option>
          <option value="callable">Sort: Callable now first</option>
          <option value="followup">Sort: Follow-up overdue first</option>
          <option value="favorites">Sort: Favorites first</option>
        </select>
        <div className="flex items-center gap-1 ml-auto">
          {/* Admin only. The API re-checks the role in the database. */}
          {isAdmin && (
            <ExportMenu
              totalCount={leads.length}
              filteredIds={filtered.map((l) => l.id)}
              selectedIds={[...selectedIds]}
              filters={{
                stage: stageFilter,
                agent: agentFilter,
                mc_status: mcFilter,
                search,
                callable_now: callableOnly,
                follow_up_due: followUpOnly,
                favorites_only: favoritesOnly,
              }}
            />
          )}
          {filtered.length > 0 && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs px-3"
                onClick={selectAll}
                disabled={allFilteredSelected}
              >
                Select all
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs px-3"
                onClick={deselectAll}
                disabled={selectedIds.size === 0}
              >
                Deselect all
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-14 flex flex-col items-center gap-2.5 text-center animate-in-fade">
            <div className="size-10 rounded-full bg-muted flex items-center justify-center">
              <Search className="size-4 text-muted-foreground/60" />
            </div>
            <p className="text-sm text-muted-foreground">
              {leads.length === 0
                ? "No leads yet. Run an ingestion to populate the list."
                : "No leads match your filter."}
            </p>
          </div>
        ) : (
          <div>
            <div className={`grid ${isAdmin ? GRID_ADMIN : GRID_AGENT} gap-4 px-4 py-2 border-b text-xs font-medium text-muted-foreground uppercase tracking-wide items-center`}>
              <input
                type="checkbox"
                checked={allFilteredSelected}
                onChange={() => (allFilteredSelected ? deselectAll() : selectAll())}
                className="size-3.5 cursor-pointer"
                aria-label="Select all"
              />
              <span>Company</span>
              <span>Location</span>
              <button
                type="button"
                onClick={() => {
                  if (sortMode !== "date") setSortMode("date")
                  else setSortDir((d) => (d === "desc" ? "asc" : "desc"))
                }}
                className="flex items-center gap-1 uppercase tracking-wide hover:text-foreground w-fit"
                title={sortDir === "desc" ? "Newest first — click for oldest first" : "Oldest first — click for newest first"}
              >
                Added
                {sortMode === "date" &&
                  (sortDir === "desc" ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
              </button>
              <span>Email Status</span>
              <span>Last email</span>
              {isAdmin && <span>Agent</span>}
              <span>Stage</span>
              <span />
            </div>
            {filtered.map((lead, i) => {
              const b = lead.brokers
              const checked = selectedIds.has(lead.id)
              const emailInfo = emailStatusByLead[lead.id]
              const opened = emailInfo?.status === "opened" || emailInfo?.status === "clicked"
              return (
                <div
                  key={lead.id}
                  className={`relative grid ${isAdmin ? GRID_ADMIN : GRID_AGENT} gap-4 px-4 py-3 border-b last:border-0 items-center transition-colors duration-150 ease-[var(--ease-out)] hover:bg-muted/40 group animate-in-fade ${
                    checked ? "bg-accent/40" : opened ? "bg-green-500/5" : ""
                  }`}
                  style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}
                >
                  <Link href={`/leads/${lead.id}`} className="absolute inset-0" aria-label={b?.company_name ?? "View lead"} />
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleOne(lead.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="relative z-10 size-3.5 cursor-pointer"
                    aria-label={`Select ${b?.company_name ?? "lead"}`}
                  />
                  <div className="pointer-events-none flex min-w-0 items-start gap-1">
                    <FavoriteButton
                      leadId={lead.id}
                      favorite={favorites.has(lead.id)}
                      onChange={(on) => setFavorite(lead.id, on)}
                      className="pointer-events-auto relative z-10 -ml-1 mt-0.5"
                    />
                  <div className="min-w-0 pointer-events-none">
                    <p className="font-medium truncate text-sm">{b?.company_name ?? "—"}</p>
                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono">
                        {b?.mc_number ? `MC-${b.mc_number}` : b?.dot_number ? `DOT-${b.dot_number}` : "—"}
                      </span>
                      {followUpByLead[lead.id]?.due && (
                        <span className="rounded-full bg-orange-100 px-1.5 py-0.5 font-medium text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">
                          Follow-up due - {followUpByLead[lead.id].days}d
                        </span>
                      )}
                    </p>
                  </div>
                  </div>
                  <div className="min-w-0 pointer-events-none leading-tight">
                    <p className="text-sm text-muted-foreground truncate">
                      {[b?.city, b?.state].filter(Boolean).join(", ") || "—"}
                    </p>
                    {/* Broker's local time + whether it's inside the calling
                        window. Blank until mount (no server/client clock mismatch);
                        the h-4 keeps the row height steady while it fills in. */}
                    <p className="mt-0.5 flex h-4 items-center gap-1.5 text-xs text-muted-foreground tabular-nums" suppressHydrationWarning>
                      {callByLead &&
                        (() => {
                          const c = callByLead.get(lead.id)
                          return c ? (
                            <>
                              <CallDot state={c.status.state} />
                              {c.clock}
                              <span className="sr-only">{c.title}</span>
                            </>
                          ) : (
                            <>
                              <CallDot state="unknown" />
                              <span className="text-muted-foreground/70">TZ unknown</span>
                            </>
                          )
                        })()}
                    </p>
                  </div>
                  <div className="min-w-0 pointer-events-none leading-tight" title={new Date(lead.created_at).toLocaleString()}>
                    <p className="text-sm text-muted-foreground" suppressHydrationWarning>
                      {new Date(lead.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </p>
                    <p className="text-xs text-muted-foreground/70 h-4" suppressHydrationWarning>
                      {now !== null ? relativeAge(lead.created_at, now) : ""}
                    </p>
                  </div>
                  <EmailStatusCell info={emailInfo} />
                  <LastEmailCell info={followUpByLead[lead.id]} />
                  {isAdmin && (
                    <div className="relative z-10">
                      <AssignedAgentSelector
                        leadId={lead.id}
                        assignedAgentId={lead.assigned_agent_id}
                        agents={
                          // A lead can still point at a since-disabled agent, who
                          // isn't in the active-only roster — keep them selectable
                          // so the dropdown doesn't misleadingly show "Unassigned".
                          lead.assigned_agent_id && lead.agents && !allAgents.some((a) => a.id === lead.assigned_agent_id)
                            ? [...allAgents, { id: lead.assigned_agent_id, name: `${lead.agents.name} (disabled)` }]
                            : allAgents
                        }
                      />
                    </div>
                  )}
                  <div className="relative z-10">
                    <StageSelector leadId={lead.id} stage={lead.stage} />
                  </div>
                  <ChevronRight className="size-4 text-muted-foreground transition-[transform,color] duration-150 ease-[var(--ease-out)] group-hover:text-foreground group-hover:translate-x-0.5 pointer-events-none" />
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Floating action bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 animate-in-rise">
          <div className="flex items-center gap-3 rounded-full border bg-card shadow-lg px-4 py-2.5">
            <span className="text-sm font-medium">
              {selectedIds.size} lead{selectedIds.size === 1 ? "" : "s"} selected
            </span>
            <div className="h-4 w-px bg-border" />
            <Button size="sm" className="h-8 gap-1.5" onClick={() => setBulkModalOpen(true)}>
              <Mail className="size-3.5" />
              {followUpOnly ? "Send follow-up" : "Send email"}
            </Button>
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setAiQueueOpen(true)}>
              <Bot className="size-3.5" />
              AI call all
            </Button>
            {isAdmin && (
              <>
                <div className="h-4 w-px bg-border" />
                <select
                  defaultValue=""
                  disabled={isAssigning}
                  onChange={async (e) => {
                    const raw = e.target.value
                    e.target.value = ""
                    if (!raw) return
                    const agentId = raw === "__unassign__" ? null : raw
                    setIsAssigning(true)
                    const { error } = await bulkAssignLeads([...selectedIds], agentId)
                    if (error) toast.error(`Failed to assign: ${error}`)
                    else toast.success(agentId ? "Leads assigned" : "Leads unassigned")
                    setIsAssigning(false)
                  }}
                  className="h-8 rounded-md border border-input bg-transparent px-2 text-xs outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                >
                  <option value="" disabled>Assign to agent…</option>
                  <option value="__unassign__">Unassign</option>
                  {allAgents.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </>
            )}
            <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={deselectAll}>
              <X className="size-3.5" />
              Clear
            </Button>
          </div>
        </div>
      )}

      {aiQueueOpen && (
        <AiCallQueueModal
          leads={leads
            .filter((l) => selectedIds.has(l.id))
            .map((l) => ({ leadId: l.id, label: l.brokers?.company_name ?? "Unknown broker" }))}
          onClose={() => setAiQueueOpen(false)}
        />
      )}

      {bulkModalOpen && (
        <BulkEmailModal
          recipients={selectedRecipients}
          templates={templates}
          followUp={followUpOnly}
          agentName={currentAgentName}
          onClose={() => setBulkModalOpen(false)}
          onFinished={() => deselectAll()}
        />
      )}
    </div>
  )
}
