"use client"

import { useRouter } from "next/navigation"
import { DISPOSITION_LABEL, type DispositionKey } from "@/lib/call-dispositions"
import { callFiltersQuery, type CallFilters, type CallRange } from "@/lib/calls/review"

const SELECT_CLASS =
  "h-9 min-w-0 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus:ring-2 focus:ring-ring"

export function CallFiltersBar({
  filters,
  agents,
}: {
  filters: CallFilters
  agents: Array<{ id: string; name: string }>
}) {
  const router = useRouter()
  const apply = (over: Partial<CallFilters>) => router.push(`/calls${callFiltersQuery(filters, over)}`)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Agent"
        value={filters.agent ?? ""}
        onChange={(e) => apply({ agent: e.target.value || null })}
        className={SELECT_CLASS}
      >
        <option value="">All agents</option>
        {agents.map((a) => (
          <option key={a.id} value={a.id}>{a.name}</option>
        ))}
      </select>

      <select
        aria-label="Date range"
        value={filters.range}
        onChange={(e) => apply({ range: e.target.value as CallRange })}
        className={SELECT_CLASS}
      >
        <option value="today">Today</option>
        <option value="week">This week</option>
        <option value="all">All time</option>
      </select>

      <select
        aria-label="Outcome"
        value={filters.outcome ?? ""}
        onChange={(e) => apply({ outcome: (e.target.value || null) as DispositionKey | null })}
        className={SELECT_CLASS}
      >
        <option value="">All outcomes</option>
        {Object.entries(DISPOSITION_LABEL).map(([key, label]) => (
          <option key={key} value={key}>{label}</option>
        ))}
      </select>

      <label className="flex h-9 items-center gap-2 px-1 text-sm">
        <input
          type="checkbox"
          checked={filters.recording}
          onChange={(e) => apply({ recording: e.target.checked })}
        />
        Has recording
      </label>
    </div>
  )
}
