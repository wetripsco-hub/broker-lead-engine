"use client"

import { useState } from "react"
import { ChevronDown, Download, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

type Mode = "all" | "filtered" | "selected"

interface ExportMenuProps {
  /** Every lead the list holds (the "all" option). */
  totalCount: number
  /** Leads matching the filters currently applied. */
  filteredIds: string[]
  /** Leads with a ticked checkbox. */
  selectedIds: string[]
  /** Human-readable description of the filters on screen, stored in the audit log. */
  filters: Record<string, string | boolean>
}

function fileNameFrom(res: Response, fallback: string): string {
  const m = res.headers.get("content-disposition")?.match(/filename="?([^";]+)"?/i)
  return m ? m[1] : fallback
}

/** Admin-only. The server re-checks the role, so hiding this is a convenience, not the protection. */
export function ExportMenu({ totalCount, filteredIds, selectedIds, filters }: ExportMenuProps) {
  const [busy, setBusy] = useState(false)

  async function run(mode: Mode) {
    if (busy) return
    const ids = mode === "filtered" ? filteredIds : mode === "selected" ? selectedIds : undefined
    if (mode !== "all" && (!ids || ids.length === 0)) {
      toast.error(mode === "selected" ? "No leads selected" : "No leads match the current filter")
      return
    }
    setBusy(true)
    const loading = toast.loading("Preparing your Excel file…")
    try {
      const res = await fetch("/api/leads/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, ids, filters: mode === "filtered" ? filters : undefined }),
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(json.error ?? `Export failed (${res.status})`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = fileNameFrom(res, `leads-${mode}.xlsx`)
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      const rows = res.headers.get("x-export-rows")
      toast.success(rows ? `Exported ${rows} lead${rows === "1" ? "" : "s"}` : "Export downloaded", { id: loading })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed", { id: loading })
    } finally {
      setBusy(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.97]"
            disabled={busy}
          />
        }
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
        {busy ? "Exporting…" : "Export"}
        <ChevronDown className="size-3 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuItem onClick={() => run("all")}>All leads ({totalCount} total)</DropdownMenuItem>
        <DropdownMenuItem onClick={() => run("filtered")} disabled={filteredIds.length === 0}>
          Current filter ({filteredIds.length})
        </DropdownMenuItem>
        {selectedIds.length > 0 && (
          <DropdownMenuItem onClick={() => run("selected")}>Selected leads ({selectedIds.length})</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
