"use client"

// "Ask support": the client asked something the agent can't answer. The agent
// types the question right here (also mid-call, from the dialer) and it goes to
// the admin as a support ticket about this lead. The admin sees it under
// Support tickets (sidebar badge) and answers there; the agent gets a badge back.

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import Link from "next/link"
import { LifeBuoy, Send, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { BODY_MAX, supportSubject } from "@/lib/tickets"
import { createTicket } from "@/app/(dashboard)/tickets/actions"

export function AskSupportButton({
  leadId,
  companyName,
  size = "sm",
  label = "Ask support",
}: {
  leadId: string
  companyName: string | null
  size?: "sm" | "xs"
  label?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={size}
        className="gap-2"
        onClick={() => setOpen(true)}
        title="Client asked something you don't know? Send the question to the support team (admin)."
      >
        <LifeBuoy className="size-3.5" />
        {label}
      </Button>
      {open && <AskSupportDialog leadId={leadId} companyName={companyName} onClose={() => setOpen(false)} />}
    </>
  )
}

function AskSupportDialog({ leadId, companyName, onClose }: { leadId: string; companyName: string | null; onClose: () => void }) {
  const [question, setQuestion] = useState("")
  const [details, setDetails] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sentId, setSentId] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  async function send() {
    setError(null)
    const q = question.trim()
    if (!q) return setError("Write the client's question first.")
    const body = details.trim() ? `Client asked:\n${q}\n\nMore details:\n${details.trim()}` : `Client asked:\n${q}`
    if (body.length > BODY_MAX) return setError(`Too long (max ${BODY_MAX} characters).`)
    setSending(true)
    const { error: err, ticketId } = await createTicket({ topic: "client", subject: supportSubject(companyName, q), body, leadId })
    setSending(false)
    if (err) return setError(err)
    toast.success("Sent to support. You'll get a badge on Support when they answer.")
    setSentId(ticketId ?? null)
  }

  if (typeof document === "undefined") return null
  // Portal: opens above the dialer too.
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Ask support">
      <div className="bg-card border rounded-xl shadow-xl w-full max-w-md flex flex-col animate-in-rise">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <LifeBuoy className="size-4" /> Ask support{companyName ? ` — ${companyName}` : ""}
          </h2>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        {sentId ? (
          <div className="px-5 py-5 space-y-3 text-sm">
            <p>Sent. The support team will see it and answer you.</p>
            <p className="text-xs text-muted-foreground">Tell the client: &ldquo;Good question, let me confirm that with my team and get right back to you.&rdquo;</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" nativeButton={false} render={<Link href={`/tickets?t=${sentId}`} />}>
                Open ticket
              </Button>
              <Button size="sm" onClick={onClose}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <div className="px-5 py-4 space-y-3 text-sm">
            <div className="space-y-1.5">
              <label htmlFor="ask-q" className="text-xs text-muted-foreground">
                What did the client ask?
              </label>
              <Textarea
                id="ask-q"
                autoFocus
                rows={3}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="e.g. Do you support factoring companies?"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="ask-d" className="text-xs text-muted-foreground">
                Anything else support should know? (optional)
              </label>
              <Textarea id="ask-d" rows={2} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="e.g. They are on the Growth plan trial, call back after 3pm" />
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button size="sm" className="gap-1.5" onClick={send} disabled={sending || !question.trim()}>
                <Send className="size-3.5" />
                {sending ? "Sending…" : "Send to support"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
