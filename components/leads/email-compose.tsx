"use client"

import { useState, useTransition } from "react"
import { Mail, X, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { sendTemplateEmail } from "@/app/(dashboard)/leads/[id]/email-actions"
import { interpolate } from "@/lib/email/resend"
import { followUpSubject } from "@/lib/follow-up/compute"

export interface ComposeTemplate {
  id: string
  name: string
  subject: string
  body: string
  type?: "initial" | "follow_up"
}

type MergeVars = Record<string, string>

interface EmailComposeProps {
  leadId: string
  brokerEmail: string | null
  templates: ComposeTemplate[]
  mergeVars: MergeVars
  /** Follow-up mode: preselects the follow-up template and replies in-thread. */
  followUp?: { previousSubject: string | null }
  triggerLabel?: string
  triggerVariant?: "default" | "outline"
}

export function EmailCompose({
  leadId,
  brokerEmail,
  templates,
  mergeVars,
  followUp,
  triggerLabel = "Send email",
  triggerVariant = "outline",
}: EmailComposeProps) {
  const [open, setOpen] = useState(false)
  const defaultTemplateId = followUp ? (templates.find((t) => t.type === "follow_up")?.id ?? "") : ""
  const [selectedId, setSelectedId] = useState<string>(defaultTemplateId)
  const [isPending, startTransition] = useTransition()

  const selected = templates.find((t) => t.id === selectedId) ?? null
  const preview = selected
    ? {
        subject:
          followUp?.previousSubject
            ? followUpSubject(followUp.previousSubject)
            : interpolate(selected.subject, mergeVars),
        body:    interpolate(selected.body, mergeVars),
      }
    : null

  function handleSend() {
    if (!selectedId) return
    startTransition(async () => {
      const { error, messageId } = await sendTemplateEmail(leadId, selectedId, { asFollowUp: !!followUp })
      if (error) {
        toast.error(`Email failed: ${error}`)
      } else {
        toast.success("Email sent")
        setOpen(false)
        setSelectedId(defaultTemplateId)
      }
    })
  }

  if (!open) {
    return (
      <Button
        variant={triggerVariant}
        size="sm"
        className="gap-2"
        onClick={() => setOpen(true)}
        disabled={!brokerEmail}
        title={brokerEmail ? undefined : "No email address for this broker"}
      >
        <Mail className="size-3.5" />
        {triggerLabel}
      </Button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-card border rounded-xl shadow-xl w-full max-w-lg flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <h2 className="font-semibold text-sm">{followUp ? "Send follow-up" : "Compose email"}</h2>
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
