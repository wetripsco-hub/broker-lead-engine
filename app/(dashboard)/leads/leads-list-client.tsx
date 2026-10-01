"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { StageBadge } from "@/components/leads/stage-badge"
import { StageSelector } from "@/components/leads/stage-selector"
import { AssignedAgentSelector } from "@/components/leads/assigned-agent-selector"
import { BulkEmailModal, type BulkRecipient } from "@/components/leads/bulk-email-modal"
import { Search, ChevronRight, Mail, X, ArrowDown, ArrowUp } from "lucide-react"
import { toast } from "sonner"
import { bulkAssignLeads } from "./actions"
import type { LeadStage } from "@/types/database"

interface LeadRow {
  id: string
  stage: LeadStage
  assigned_agent_id: string | null
  created_at: string
  brokers: {
    mc_number: string
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
const GRID_ADMIN = "grid-cols-[28px_1fr_140px_100px_110px_180px_100px_32px]"
const GRID_AGENT = "grid-cols-[28px_1fr_140px_100px_110px_100px_32px]"

function relativeAge(iso: string, now: number): string {
  const mins = Math.floor((now - new Date(iso).getTime()) / 60_000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

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
}: {
  leads: LeadRow[]
  isAdmin: boolean
  templates: Template[]
  currentAgentName: string
  emailStatusByLead: Record<string, EmailStatusInfo>
  allAgents: Array<{ id: string; name: string }>
}) {
  const [stageFilter, setStageFilter] = useState<LeadStage | "all">("all")
  const [agentFilter, setAgentFilter] = useState<string>("all") // "all" | "unassigned" | agentId
  const [search, setSearch] = useState("")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkModalOpen, setBulkModalOpen] = useState(false)
  const [isAssigning, setIsAssigning] = useState(false)
  // Newest first by default: the freshly scraped leads are what you look for.
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc")
  // Relative ages depend on the current time, so they're filled in after
  // mount — rendering them on the server would mismatch on hydration.
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => setNow(Date.now()), [])

  const matching = leads.filter((l) => {
    if (stageFilter !== "all" && l.stage !== stageFilter) return false
    if (agentFilter === "unassigned" && l.assigned_agent_id !== null) return false
    if (agentFilter !== "all" && agentFilter !== "unassigned" && l.assigned_agent_id !== agentFilter) return false
    if (search) {
      const q = search.toLowerCase()
      const b = l.brokers
      if (!b) return false
      return (
        b.company_name.toLowerCase().includes(q) ||
        b.mc_number.includes(q) ||
        b.state?.toLowerCase().includes(q) ||
        b.city?.toLowerCase().includes(q) ||
        false
      )
    }
    return true
  })

  const filtered = [...matching].sort((a, b) => {
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
        {filtered.length > 0 && (
          <div className="flex items-center gap-1 ml-auto">
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
          </div>
        )}
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
                onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
                className="flex items-center gap-1 uppercase tracking-wide hover:text-foreground w-fit"
                title={sortDir === "desc" ? "Newest first — click for oldest first" : "Oldest first — click for newest first"}
              >
                Added
                {sortDir === "desc" ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />}
              </button>
              <span>Email Status</span>
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
                  <div className="min-w-0 pointer-events-none">
                    <p className="font-medium truncate text-sm">{b?.company_name ?? "—"}</p>
                    <p className="text-xs text-muted-foreground font-mono">MC-{b?.mc_number}</p>
                  </div>
                  <span className="text-sm text-muted-foreground truncate pointer-events-none">
                    {[b?.city, b?.state].filter(Boolean).join(", ") || "—"}
                  </span>
                  <div className="min-w-0 pointer-events-none leading-tight" title={new Date(lead.created_at).toLocaleString()}>
                    <p className="text-sm text-muted-foreground" suppressHydrationWarning>
                      {new Date(lead.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </p>
                    <p className="text-xs text-muted-foreground/70 h-4" suppressHydrationWarning>
                      {now !== null ? relativeAge(lead.created_at, now) : ""}
                    </p>
                  </div>
                  <EmailStatusCell info={emailInfo} />
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
              Send email
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

      {bulkModalOpen && (
        <BulkEmailModal
          recipients={selectedRecipients}
          templates={templates}
          agentName={currentAgentName}
          onClose={() => setBulkModalOpen(false)}
          onFinished={() => deselectAll()}
        />
      )}
    </div>
  )
}
