"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { StageBadge } from "@/components/leads/stage-badge"
import { StageSelector } from "@/components/leads/stage-selector"
import { BulkEmailModal, type BulkRecipient } from "@/components/leads/bulk-email-modal"
import { Search, ChevronRight, Mail, X } from "lucide-react"
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
}: {
  leads: LeadRow[]
  isAdmin: boolean
  templates: Template[]
  currentAgentName: string
}) {
  const [stageFilter, setStageFilter] = useState<LeadStage | "all">("all")
  const [search, setSearch] = useState("")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkModalOpen, setBulkModalOpen] = useState(false)

  const filtered = leads.filter((l) => {
    if (stageFilter !== "all" && l.stage !== stageFilter) return false
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
            <div className="grid grid-cols-[28px_1fr_140px_180px_100px_32px] gap-4 px-4 py-2 border-b text-xs font-medium text-muted-foreground uppercase tracking-wide items-center">
              <input
                type="checkbox"
                checked={allFilteredSelected}
                onChange={() => (allFilteredSelected ? deselectAll() : selectAll())}
                className="size-3.5 cursor-pointer"
                aria-label="Select all"
              />
              <span>Company</span>
              <span>Location</span>
              {isAdmin && <span>Agent</span>}
              <span>Stage</span>
              <span />
            </div>
            {filtered.map((lead, i) => {
              const b = lead.brokers
              const checked = selectedIds.has(lead.id)
              return (
                <div
                  key={lead.id}
                  className={`relative grid grid-cols-[28px_1fr_140px_180px_100px_32px] gap-4 px-4 py-3 border-b last:border-0 items-center transition-colors duration-150 ease-[var(--ease-out)] hover:bg-muted/40 group animate-in-fade ${checked ? "bg-accent/40" : ""}`}
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
                  {isAdmin && (
                    <span className="text-sm text-muted-foreground truncate pointer-events-none">
                      {lead.agents?.name ?? <span className="italic">Unassigned</span>}
                    </span>
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
