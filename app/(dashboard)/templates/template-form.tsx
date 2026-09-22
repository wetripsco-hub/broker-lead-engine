"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { toast } from "sonner"
import { createTemplate, updateTemplate } from "./actions"

const MERGE_TAGS = [
  "{{company_name}}",
  "{{contact_name}}",
  "{{mc_number}}",
  "{{state}}",
  "{{city}}",
  "{{agent_name}}",
]

interface TemplateFormProps {
  template?: { id: string; name: string; subject: string; body: string }
  onCancel?: () => void
  onSaved?: () => void
}

export function TemplateForm({ template, onCancel, onSaved }: TemplateFormProps) {
  const isEdit = !!template
  const [name,    setName]    = useState(template?.name    ?? "")
  const [subject, setSubject] = useState(template?.subject ?? "")
  const [body,    setBody]    = useState(template?.body    ?? "")
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const fd = new FormData()
    fd.set("name", name)
    fd.set("subject", subject)
    fd.set("body", body)
    startTransition(async () => {
      const result = isEdit
        ? await updateTemplate(template!.id, fd)
        : await createTemplate(fd)
      if (result && "error" in result && result.error) {
        toast.error(result.error)
      } else {
        onSaved?.()
      }
    })
  }

  function insertTag(tag: string) {
    setBody((prev) => prev + tag)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1">Template name</label>
        <Input
          value={name}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
          placeholder="e.g. Initial outreach"
          required
        />
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1">Subject</label>
        <Input
          value={subject}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSubject(e.target.value)}
          placeholder="e.g. Partnering with {{company_name}}"
          required
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-muted-foreground">Body</label>
          <div className="flex gap-1 flex-wrap justify-end">
            {MERGE_TAGS.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => insertTag(tag)}
                className="text-[10px] px-1.5 py-0.5 rounded bg-muted hover:bg-muted/80 font-mono text-muted-foreground"
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
        <textarea
          value={body}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setBody(e.target.value)}
          placeholder={"Hi {{contact_name}},\n\nI came across {{company_name}}…"}
          required
          rows={10}
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring resize-y font-mono"
        />
      </div>

      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Saving…" : isEdit ? "Update template" : "Create template"}
        </Button>
      </div>
    </form>
  )
}
