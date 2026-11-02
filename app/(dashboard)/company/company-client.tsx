"use client"

import { useState } from "react"
import { Pencil, Save, X, Building2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { MarkdownView } from "@/components/company/markdown-view"
import { saveCompanyInfo } from "./actions"

export function CompanyClient({ body, updatedAt, isAdmin }: { body: string; updatedAt: string | null; isAdmin: boolean }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(body)
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    const { error } = await saveCompanyInfo(draft)
    setSaving(false)
    if (error) toast.error(`Save failed: ${error}`)
    else {
      toast.success("Company page saved")
      setEditing(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {updatedAt ? `Last updated ${new Date(updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}` : ""}
        </p>
        {isAdmin && !editing && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              setDraft(body)
              setEditing(true)
            }}
          >
            <Pencil className="size-3.5" />
            Edit
          </Button>
        )}
        {isAdmin && editing && (
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setEditing(false)} disabled={saving}>
              <X className="size-3.5" />
              Cancel
            </Button>
            <Button size="sm" className="gap-1.5" onClick={save} disabled={saving}>
              <Save className="size-3.5" />
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={28}
            spellCheck
            aria-label="Company page (markdown)"
            className="w-full rounded-lg border border-input bg-transparent px-3 py-2 font-mono text-sm leading-relaxed outline-none focus:ring-2 focus:ring-ring"
          />
          <p className="text-xs text-muted-foreground">
            Markdown: # heading, ## subheading, - bullet, 1. numbered, **bold**, --- for a divider line.
          </p>
        </div>
      ) : body.trim() ? (
        <article className="rounded-lg border bg-card p-5 sm:p-7">
          <MarkdownView source={body} />
        </article>
      ) : (
        <div className="rounded-lg border bg-card py-14 flex flex-col items-center gap-2.5 text-center">
          <Building2 className="size-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            {isAdmin ? "Nothing here yet. Click Edit to write the company page." : "Nothing here yet."}
          </p>
        </div>
      )}
    </div>
  )
}
