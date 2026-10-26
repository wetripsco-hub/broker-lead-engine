"use client"

import { useState, useTransition, useRef, useEffect } from "react"
import { Send, MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { sendLeadSms } from "@/app/(dashboard)/leads/[id]/sms-actions"
import { formatPhoneDisplay, toE164 } from "@/lib/phone"
import { CALL_SCRIPT } from "@/lib/call-script/script"
import { agentNames, fillText, type ScriptVars } from "@/lib/call-script/fill"
import { contactFirstNameOrNull } from "@/lib/voice-agents/names"

interface SmsEvent {
  id: string
  direction: "inbound" | "outbound"
  message_body: string | null
  status: string
  occurred_at: string
  agents: { name: string } | null
}

interface SmsThreadProps {
  leadId: string
  brokerPhone: string | null
  brokerName: string | null
  templates?: Array<{ id: string; label: string; text: string }>
  /** False when the lead cannot be texted by this user; `blockedReason` says why. */
  canSend?: boolean
  blockedReason?: string | null
  /** When SMS permission was recorded on a call (shown as a small note). */
  smsConsentAt?: string | null
  /** For filling the script's text templates. */
  contactName?: string | null
  agentName?: string | null
  callbackPhone?: string | null
  initialEvents: SmsEvent[]
}

const STATUS_LABEL: Record<string, string> = {
  sent:      "Sent",
  delivered: "Delivered",
  failed:    "Failed",
  pending:   "Pending",
}

export function SmsThread({
  leadId,
  brokerPhone,
  brokerName,
  templates = [],
  canSend = true,
  blockedReason = null,
  smsConsentAt = null,
  contactName = null,
  agentName = null,
  callbackPhone = null,
  initialEvents,
}: SmsThreadProps) {
  const [events, setEvents] = useState<SmsEvent[]>(initialEvents)
  const [text, setText] = useState("")
  const [isPending, startTransition] = useTransition()
  const bottomRef = useRef<HTMLDivElement>(null)

  // Scroll to bottom on new message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [events.length])

  // The two "Text after permission" messages from the call script, filled in for this lead.
  const scriptTemplates = (() => {
    const a = agentNames(agentName)
    const vars: ScriptVars = {
      name: contactFirstNameOrNull(contactName),
      firstName: a.firstName,
      fullName: a.fullName,
      phone: callbackPhone,
      day: "",
      time: "",
    }
    const section = CALL_SCRIPT.find((s) => s.id === "text")
    return (section?.items ?? []).map((it) => ({
      id: `script-${it.id}`,
      label: `Script: ${it.title}`,
      text: fillText(it.lines.map((l) => l.text).join(" "), vars),
    }))
  })()
  const allTemplates = [...templates, ...scriptTemplates]

  function handleSend() {
    if (!canSend || !brokerPhone || !text.trim()) return
    if (/\[(Name|First Name|Full Name|day|time|number|Phone)\]/.test(text)) {
      toast.error("The text still has a [placeholder]. Fill it in first.")
      return
    }
    if (!toE164(brokerPhone)) {
      toast.error("Invalid phone number")
      return
    }
    const draft = text.trim()
    setText("")

    // Optimistic update
    const optimistic: SmsEvent = {
      id: `optimistic-${Date.now()}`,
      direction: "outbound",
      message_body: draft,
      status: "sending",
      occurred_at: new Date().toISOString(),
      agents: null,
    }
    setEvents((prev) => [...prev, optimistic])

    startTransition(async () => {
      const { error } = await sendLeadSms(leadId, brokerPhone, draft)
      if (error) {
        toast.error(`SMS failed: ${error}`)
        // Remove optimistic row on failure
        setEvents((prev) => prev.filter((e) => e.id !== optimistic.id))
        setText(draft)
      }
      // On success, revalidatePath triggers a server re-render which updates initialEvents
      // The optimistic row stays until next navigation; acceptable for now
    })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const smsList = events.filter((e) => e.message_body)

  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-2">
        <MessageSquare className="size-3.5" />
        SMS Thread
        {brokerPhone && (
          <span className="font-mono font-normal normal-case text-xs">{formatPhoneDisplay(brokerPhone)}</span>
        )}
      </h2>

      <div className="rounded-lg border bg-card flex flex-col">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto max-h-80 p-4 space-y-3">
          {smsList.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No messages yet.{brokerPhone ? " Send one below." : " No phone number on this lead."}
            </p>
          ) : (
            smsList.map((ev) => {
              const isOutbound = ev.direction === "outbound"
              return (
                <div
                  key={ev.id}
                  className={`flex flex-col gap-0.5 ${isOutbound ? "items-end" : "items-start"}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                      isOutbound
                        ? "bg-foreground text-background rounded-br-sm"
                        : "bg-muted text-foreground rounded-bl-sm"
                    }`}
                  >
                    {ev.message_body}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground px-1">
                    {isOutbound ? (
                      <>
                        <span>{STATUS_LABEL[ev.status] ?? ev.status}</span>
                        <span>·</span>
                        <span>{new Date(ev.occurred_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                      </>
                    ) : (
                      <>
                        <span>{brokerName ?? "Broker"}</span>
                        <span>·</span>
                        <span>{new Date(ev.occurred_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                      </>
                    )}
                  </div>
                </div>
              )
            })
          )}
          <div ref={bottomRef} />
        </div>

        {/* Compose */}
        {brokerPhone ? (
          <div className="border-t p-3 space-y-2">
            {!canSend && blockedReason && (
              <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                {blockedReason}
              </p>
            )}
            {canSend && smsConsentAt && (
              <p className="text-xs text-muted-foreground">
                SMS permission recorded {new Date(smsConsentAt).toLocaleDateString()}.
              </p>
            )}
            {allTemplates.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Quick text:</span>
                {allTemplates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    disabled={isPending || !canSend}
                    onClick={() => setText(t.text)}
                    className="rounded-full border border-input px-2.5 py-1 text-xs transition-[background-color,transform] duration-150 ease-[var(--ease-out)] hover:bg-muted active:scale-[0.97] disabled:opacity-50"
                    title={t.text}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-2 items-end">
            <textarea
              value={text}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message… (Enter to send)"
              rows={2}
              disabled={isPending || !canSend}
              className="flex-1 resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground disabled:opacity-50"
            />
            <Button
              size="sm"
              className="gap-1.5 shrink-0"
              onClick={handleSend}
              disabled={!text.trim() || isPending || !canSend}
            >
              <Send className="size-3.5" />
              Send
            </Button>
            </div>
          </div>
        ) : (
          <div className="border-t px-4 py-3 text-xs text-muted-foreground italic">
            Add a phone number to this broker to enable SMS.
          </div>
        )}
      </div>
    </section>
  )
}
