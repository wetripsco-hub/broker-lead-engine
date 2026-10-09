"use client"

import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { markAiCallConsentBulk } from "@/app/(dashboard)/leads/admin-actions"

// Admin-only: record AI-call consent for the selected leads in one go.
export function BulkConsentModal({
  leadIds,
  onClose,
  onDone,
}: {
  leadIds: string[]
  onClose: () => void
  onDone: () => void
}) {
  const [source, setSource] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !pending && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose, pending])

  function save() {
    startTransition(async () => {
      const r = await markAiCallConsentBulk(leadIds, source)
      if (r.error) {
        toast.error(r.error)
        return
      }
      const parts = [`${r.marked} marked`]
      if (r.alreadyHad) parts.push(`${r.alreadyHad} already had consent`)
      if (r.skippedDnc) parts.push(`${r.skippedDnc} skipped (do-not-call)`)
      if (r.notFound) parts.push(`${r.notFound} not found`)
      toast.success(parts.join(", "))
      onDone()
      onClose()
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 animate-in-fade"
      onClick={(e) => e.target === e.currentTarget && !pending && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Record AI-call consent"
        className="w-full max-w-md rounded-xl border bg-card p-5 text-left shadow-xl animate-in-rise"
      >
        <h2 className="mb-3 text-sm font-semibold">
          Record AI-call consent for {leadIds.length} lead{leadIds.length === 1 ? "" : "s"}
        </h2>
        <p className="text-sm text-muted-foreground">
          Only use this if these brokers actually agreed to receive calls from the AI agent. Leads that already have
          consent keep their original record, and do-not-call leads are skipped.
        </p>
        <label className="mt-3 block text-xs text-muted-foreground" htmlFor="bulk-consent-source">
          Source (required)
        </label>
        <textarea
          id="bulk-consent-source"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          rows={3}
          maxLength={300}
          placeholder="e.g. Replied YES to email campaign on 3 Oct"
          className="mt-1 w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          autoFocus
        />
        <label className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" />
          I confirm these brokers gave consent to be called by the AI agent.
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={pending || !source.trim() || !confirmed}>
            {pending ? "Saving…" : "Record consent"}
          </Button>
        </div>
      </div>
    </div>
  )
}
