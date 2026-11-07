"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { renderTemplate, SAMPLE_NAME } from "@/lib/recruiter/template"
import { deleteRecruitTemplate, saveRecruitTemplate } from "./actions"
import type { RecruitTemplate } from "./types"

export function TemplatesPanel({ templates }: { templates: RecruitTemplate[] }) {
  const [editing, setEditing] = useState<RecruitTemplate | "new" | null>(null)
  const [, start] = useTransition()
  const router = useRouter()

  function remove(t: RecruitTemplate) {
    if (!confirm(`Delete template "${t.name}"?`)) return
    start(async () => {
      const r = await deleteRecruitTemplate(t.id)
      if (r.error) toast.error(r.error)
      else {
        toast.success("Template deleted")
        router.refresh()
      }
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Recruiter templates only (separate from broker templates). Use <code className="text-xs">{"{{first_name}}"}</code> and{" "}
          <code className="text-xs">{"{{name}}"}</code>.
        </p>
        {!editing && (
          <Button size="sm" className="gap-1.5" onClick={() => setEditing("new")}>
            <Plus className="size-3.5" /> New template
          </Button>
        )}
      </div>

      {editing && (
        <TemplateEditor
          template={editing === "new" ? null : editing}
          onDone={() => {
            setEditing(null)
            router.refresh()
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      {templates.length === 0 && !editing ? (
        <div className="rounded-lg border bg-card py-12 text-center text-sm text-muted-foreground">No recruiter templates yet.</div>
      ) : (
        templates.map((t) =>
          editing !== "new" && editing?.id === t.id ? null : (
            <div key={t.id} className="rounded-lg border bg-card px-4 py-3 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{t.name}</p>
                <p className="text-xs text-muted-foreground truncate">Subject: {t.subject}</p>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2 whitespace-pre-line">{t.body}</p>
              </div>
              <Button size="icon-sm" variant="ghost" onClick={() => setEditing(t)} aria-label="Edit">
                <Pencil className="size-3.5" />
              </Button>
              <Button size="icon-sm" variant="ghost" onClick={() => remove(t)} aria-label="Delete">
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ),
        )
      )}
    </div>
  )
}

function TemplateEditor({ template, onDone, onCancel }: { template: RecruitTemplate | null; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState(template?.name ?? "")
  const [subject, setSubject] = useState(template?.subject ?? "")
  const [body, setBody] = useState(template?.body ?? "Hi {{first_name}},\n\n")
  const [saving, start] = useTransition()
  const sample = { name: SAMPLE_NAME }

  function save() {
    start(async () => {
      const r = await saveRecruitTemplate({ id: template?.id, name, subject, body })
      if (r.error) toast.error(r.error)
      else {
        toast.success("Template saved")
        onDone()
      }
    })
  }

  return (
    <div className="rounded-lg border bg-card p-4 grid gap-4 md:grid-cols-2">
      <div className="space-y-3">
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Name</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9 text-sm" placeholder="First outreach" />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Subject</label>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} className="h-9 text-sm" placeholder="Sales role at Loadlinkers, {{first_name}}" />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Body</label>
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={12} className="text-sm font-mono" />
        </div>
        <div className="flex gap-2 justify-end">
          <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save template"}</Button>
        </div>
      </div>
      <div className="rounded-md border bg-muted/30 p-4 text-sm">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Preview (for {SAMPLE_NAME})</p>
        <p className="font-medium">{renderTemplate(subject, sample) || <span className="text-muted-foreground">No subject</span>}</p>
        <div className="mt-3 whitespace-pre-wrap leading-relaxed">{renderTemplate(body, sample)}</div>
      </div>
    </div>
  )
}
