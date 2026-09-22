"use client"

import { useState } from "react"
import Link from "next/link"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { StageBadge } from "@/components/leads/stage-badge"
import { StageSelector } from "@/components/leads/stage-selector"
import { Search, ChevronRight } from "lucide-react"
import type { LeadStage } from "@/types/database"

interface LeadRow {
  id: string
  stage: LeadStage
  assigned_agent_id: string | null
  created_at: string
  brokers: {
    mc_number: string
    company_name: string
    city: string | null
    state: string | null
    phone: string | null
    email: string | null
  } | null
  agents: { name: string } | null
}

const STAGE_FILTERS: { value: LeadStage | "all"; label: string }[] = [
  { value: "all",        label: "All" },
  { value: "new",        label: "New" },
  { value: "contacted",  label: "Contacted" },
  { value: "interested", label: "Interested" },
  { value: "converted",  label: "Converted" },
  { value: "dead",       label: "Dead" },
]

export function LeadsListClient({ leads, isAdmin }: { leads: LeadRow[]; isAdmin: boolean }) {
  const [stageFilter, setStageFilter] = useState<LeadStage | "all">("all")
  const [search, setSearch] = useState("")

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

  return (
    <div className="space-y-4">
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
      </div>

      {/* Table */}
      <div className="rounded-lg border bg-card">
        {filtered.length === 0 ? (
          <div className="py-14 flex flex-col items-center gap-2 text-center">
            <Search className="size-6 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              {leads.length === 0
                ? "No leads yet. Run an ingestion to populate the list."
                : "No leads match your filter."}
            </p>
          </div>
        ) : (
          <div>
            <div className="grid grid-cols-[1fr_140px_180px_100px_32px] gap-4 px-4 py-2 border-b text-xs font-medium text-muted-foreground uppercase tracking-wide">
              <span>Company</span>
              <span>Location</span>
              {isAdmin && <span>Agent</span>}
              <span>Stage</span>
              <span />
            </div>
            {filtered.map((lead) => {
              const b = lead.brokers
              return (
                <div
                  key={lead.id}
                  className="grid grid-cols-[1fr_140px_180px_100px_32px] gap-4 px-4 py-3 border-b last:border-0 items-center hover:bg-muted/40 group"
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate text-sm">{b?.company_name ?? "—"}</p>
                    <p className="text-xs text-muted-foreground font-mono">MC-{b?.mc_number}</p>
                  </div>
                  <span className="text-sm text-muted-foreground truncate">
                    {[b?.city, b?.state].filter(Boolean).join(", ") || "—"}
                  </span>
                  {isAdmin && (
                    <span className="text-sm text-muted-foreground truncate">
                      {lead.agents?.name ?? <span className="italic">Unassigned</span>}
                    </span>
                  )}
                  <StageSelector leadId={lead.id} stage={lead.stage} />
                  <Link href={`/leads/${lead.id}`} className="text-muted-foreground hover:text-foreground">
                    <ChevronRight className="size-4" />
                  </Link>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
