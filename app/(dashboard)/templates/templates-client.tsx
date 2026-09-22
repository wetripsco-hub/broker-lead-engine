"use client"

import { useState, useTransition } from "react"
import { Pencil, Trash2, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { TemplateForm } from "./template-form"
import { deleteTemplate } from "./actions"
import { toast } from "sonner"

interface Template {
  id: string
  name: string
  subject: string
  body: string
  created_at: string
}

export function TemplatesClient({ templates, isAdmin }: { templates: Template[]; isAdmin: boolean }) {
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  function handleDelete(id: string, name: string) {
    if (!confirm(`Delete template "${name}"?`)) return
    startTransition(async () => {
      const { error } = await deleteTemplate(id)
      if (error) toast.error(`Delete failed: ${error}`)
      else toast.success("Template deleted")
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Email Templates</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Reusable templates with merge tags for personalisation
          </p>
        </div>
        {!creating && (
          <Button size="sm" className="gap-2" onClick={() => setCreating(true)}>
            <Plus className="size-3.5" />
            New template
          </Button>
        )}
      </div>

      {/* Create form */}
      {creating && (
        <div className="rounded-lg border bg-card p-5">
          <h2 className="text-sm font-semibold mb-4">New template</h2>
          <TemplateForm
            onCancel={() => setCreating(false)}
            onSaved={() => setCreating(false)}
          />
        </div>
      )}

      {/* List */}
      {templates.length === 0 && !creating ? (
        <div className="rounded-lg border bg-card py-12 text-center text-sm text-muted-foreground">
          No templates yet. Click "New template" to create one.
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map((t) => (
            <div key={t.id} className="rounded-lg border bg-card">
              {editingId === t.id ? (
                <div className="p-5">
                  <h2 className="text-sm font-semibold mb-4">Edit template</h2>
                  <TemplateForm
                    template={t}
                    onCancel={() => setEditingId(null)}
                    onSaved={() => setEditingId(null)}
                  />
                </div>
              ) : (
                <div className="px-5 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-medium text-sm">{t.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        Subject: {t.subject}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-muted-foreground"
                        onClick={() => setEditingId(t.id)}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      {isAdmin && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-muted-foreground hover:text-destructive"
                          onClick={() => handleDelete(t.id, t.name)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                  <pre className="mt-3 text-xs text-muted-foreground font-sans whitespace-pre-wrap line-clamp-3 bg-muted/30 rounded p-2">
                    {t.body}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
