"use client"

import { useMemo, useState } from "react"
import { Mail, X, Send, CheckCircle2, XCircle, Clock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { sendTemplateEmail } from "@/app/(dashboard)/leads/[id]/email-actions"
import { interpolate } from "@/lib/email/resend"

const MAX_BATCH = 50
const DELAY_BETWEEN_MS = 30_000

interface Template {
  id: string
  name: string
  subject: string
  body: string
}

export interface BulkRecipient {
  leadId: string
  companyName: string
  contactName: string | null
  mcNumber: string
  state: string | null
  city: string | null
  email: string | null
}

type RowStatus = "pending" | "no_email" | "sending" | "sent" | "failed"

interface Row extends BulkRecipient {
  status: RowStatus
  error?: string
}

interface BulkEmailModalProps {
  recipients: BulkRecipient[]
  templates: Template[]
  agentName: string
  onClose: () => void
  onFinished: () => void
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function BulkEmailModal({ recipients, templates, agentName, onClose, onFinished }: BulkEmailModalProps) {
  const capped = useMemo(() => recipients.slice(0, MAX_BATCH), [recipients])
  const overflow = recipients.length - capped.length

  const [selectedId, setSelectedId] = useState("")
  const [rows, setRows] = useState<Row[]>(() =>
    capped.map((r) => ({ ...r, status: r.email ? "pending" : "no_email" }))
  )
  const [phase, setPhase] = useState<"compose" | "sending" | "done">("compose")
  const [sendIndex, setSendIndex] = useState(0)

  const selected = templates.find((t) => t.id === selectedId) ?? null
  const first = capped[0]
  const preview = selected && first
    ? {
        subject: interpolate(selected.subject, {
          company_name: first.companyName,
          contact_name: first.contactName ?? first.companyName,
          mc_number: first.mcNumber,
          state: first.state ?? "",
          city: first.city ?? "",
          agent_name: agentName,
        }),
        body: interpolate(selected.body, {
          company_name: first.companyName,
          contact_name: first.contactName ?? first.companyName,
          mc_number: first.mcNumber,
          state: first.state ?? "",
          city: first.city ?? "",
          agent_name: agentName,
        }),
      }
    : null

  const sendableCount = rows.filter((r) => r.status !== "no_email").length
  const sentCount = rows.filter((r) => r.status === "sent").length
  const failedCount = rows.filter((r) => r.status === "failed").length
  const isSending = phase === "sending"
  const isDone = phase === "done"

  async function handleSend() {
    if (!selectedId || sendableCount === 0) return
    setPhase("sending")

    const targets = rows.filter((r) => r.status !== "no_email")
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i]
      setSendIndex(i + 1)
      setRows((prev) => prev.map((r) => (r.leadId === target.leadId ? { ...r, status: "sending" } : r)))

      const { error } = await sendTemplateEmail(target.leadId, selectedId)

      setRows((prev) =>
        prev.map((r) =>
          r.leadId === target.leadId
            ? { ...r, status: error ? "failed" : "sent", error: error ?? undefined }
            : r
        )
      )

      if (i < targets.length - 1) await sleep(DELAY_BETWEEN_MS)
    }

    setPhase("done")
    onFinished()
  }

  function handleClose() {
    if (isSending) return
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-card border rounded-xl shadow-xl w-full max-w-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <Mail className="size-4" />
            Bulk email — {recipients.length} lead{recipients.length === 1 ? "" : "s"} selected
          </h2>
          <button
            onClick={handleClose}
            disabled={isSending}
            className="text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {overflow > 0 && (
            <p className="text-xs rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400 px-3 py-2">
              Max {MAX_BATCH} per batch — only the first {MAX_BATCH} selected leads will be emailed
              ({overflow} skipped).
            </p>
          )}

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
                disabled={isSending || isDone}
                className="w-full h-8 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
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
              <p className="text-xs text-muted-foreground">Preview — first recipient ({first.companyName})</p>
              <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Subject</p>
                  <p className="text-sm font-medium">{preview.subject}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Body</p>
                  <pre className="text-sm whitespace-pre-wrap font-sans max-h-32 overflow-y-auto">
                    {preview.body}
                  </pre>
                </div>
              </div>
            </div>
          )}

          {/* Recipient list */}
          <div>
            <p className="text-xs text-muted-foreground mb-1">
              Recipients ({sendableCount} sendable{rows.length > sendableCount ? `, ${rows.length - sendableCount} without an email` : ""})
            </p>
            <div className="rounded-md border divide-y max-h-56 overflow-y-auto">
              {rows.map((r) => (
                <div key={r.leadId} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{r.companyName}</p>
                    <p className="truncate text-xs text-muted-foreground">{r.email ?? "No email on file"}</p>
                  </div>
                  <RowStatusBadge row={r} />
                </div>
              ))}
            </div>
          </div>

          {/* Progress */}
          {(isSending || isDone) && (
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              {isSending && (
                <p className="flex items-center gap-2">
                  <Clock className="size-3.5 animate-pulse text-muted-foreground" />
                  Sending {sendIndex}/{sendableCount}…
                </p>
              )}
              {isDone && (
                <p className="flex items-center gap-2 font-medium">
                  Done — {sentCount} sent, {failedCount} failed
                  {rows.length - sendableCount > 0 ? `, ${rows.length - sendableCount} skipped (no email)` : ""}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t shrink-0 flex justify-end gap-2">
          {isDone ? (
            <Button size="sm" onClick={onClose}>Close</Button>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={handleClose} disabled={isSending}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="gap-2"
                onClick={handleSend}
                disabled={!selectedId || isSending || sendableCount === 0}
              >
                <Send className="size-3.5" />
                {isSending ? "Sending…" : `Send to ${sendableCount} lead${sendableCount === 1 ? "" : "s"}`}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function RowStatusBadge({ row }: { row: Row }) {
  switch (row.status) {
    case "no_email":
      return <span className="text-xs text-muted-foreground shrink-0">No email</span>
    case "pending":
      return <span className="text-xs text-muted-foreground shrink-0">Ready</span>
    case "sending":
      return (
        <span className="text-xs text-amber-600 dark:text-amber-400 shrink-0 flex items-center gap-1">
          <Clock className="size-3 animate-pulse" /> Sending…
        </span>
      )
    case "sent":
      return (
        <span className="text-xs text-green-600 dark:text-green-400 shrink-0 flex items-center gap-1">
          <CheckCircle2 className="size-3" /> Sent
        </span>
      )
    case "failed":
      return (
        <span className="text-xs text-destructive shrink-0 flex items-center gap-1" title={row.error}>
          <XCircle className="size-3" /> Failed
        </span>
      )
  }
}
