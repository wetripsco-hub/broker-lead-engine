"use client"

import { useState, useTransition } from "react"
import { Mail, X, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { sendTemplateEmail } from "@/app/(dashboard)/leads/[id]/email-actions"
import { interpolate } from "@/lib/email/resend"

interface Template {
  id: string
  name: string
  subject: string
  body: string
}

type MergeVars = Record<string, string>

interface EmailComposeProps {
  leadId: string
  brokerEmail: string | null
  templates: Template[]
  mergeVars: MergeVars
}

export function EmailCompose({ leadId, brokerEmail, templates, mergeVars }: EmailComposeProps) {
  const [open, setOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string>("")
  const [isPending, startTransition] = useTransition()

  const selected = templates.find((t) => t.id === selectedId) ?? null
  const preview = selected
    ? {
        subject: interpolate(selected.subject, mergeVars),
        body:    interpolate(selected.body, mergeVars),
      }
    : null

  function handleSend() {
    if (!selectedId) return
    startTransition(async () => {
      const { error, messageId } = await sendTemplateEmail(leadId, selectedId)
      if (error) {
        toast.error(`Email failed: ${error}`)
      } else {
        toast.success("Email sent")
        setOpen(false)
        setSelectedId("")
      }
    })
  }

  if (!open) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="gap-2"
        onClick={() => setOpen(true)}
        disabled={!brokerEmail}
        title={brokerEmail ? undefined : "No email address for this broker"}
      >
        <Mail className="size-3.5" />
        Send email
      </Button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-card border rounded-xl shadow-xl w-full max-w-lg flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <h2 className="font-semibold text-sm">Compose email</h2>
          <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* To */}
          <div>
            <p className="text-xs text-muted-foreground mb-1">To</p>
            <p className="text-sm font-medium">{brokerEmail}</p>
          </div>

          {/* Template picker */}
          <div>
            <p className="text-xs text-muted-foreground mb-1">Template</p>
            {templates.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">
                No templates yet. Create one in{" "}
                <a href="/templates" className="underline">Templates</a>.
              </p>
            ) : (
              <select
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                className="w-full h-8 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">— select a template —</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Preview */}
          {preview && (
            <div className="space-y-2">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Subject</p>
                <p className="text-sm font-medium">{preview.subject}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Body</p>
                <pre className="text-sm whitespace-pre-wrap font-sans bg-muted/50 rounded p-3 max-h-48 overflow-y-auto">
                  {preview.body}
                </pre>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t shrink-0 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="gap-2"
            onClick={handleSend}
            disabled={!selectedId || isPending}
          >
            <Send className="size-3.5" />
            {isPending ? "Sending…" : "Send"}
          </Button>
        </div>
      </div>
    </div>
  )
}
