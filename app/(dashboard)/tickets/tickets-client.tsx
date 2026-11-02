"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, LifeBuoy, Plus, Send, Search, CheckCircle2, RotateCcw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { STATUS_LABEL, TOPIC_LABEL, SUBJECT_MAX, BODY_MAX, type TicketStatus, type TicketTopic } from "@/lib/tickets"
import { createTicket, replyToTicket, setTicketClosed } from "./actions"

export interface TicketListItem {
  id: string
  topic: TicketTopic
  subject: string
  status: TicketStatus
  agentUnread: boolean
  createdAt: string
  lastMessageAt: string
  agentName: string
  leadId: string | null
  leadLabel: string | null
}

export interface TicketMessage {
  id: string
  fromAdmin: boolean
  body: string
  createdAt: string
}

export interface LeadOption {
  id: string
  label: string
}

const STATUS_STYLE: Record<TicketStatus, string> = {
  open: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  answered: "border-green-600/30 bg-green-600/10 text-green-700 dark:text-green-400",
  closed: "border-border bg-muted text-muted-foreground",
}

function StatusPill({ status }: { status: TicketStatus }) {
  return (
    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  )
}

function when(iso: string): string {
  const d = new Date(iso)
  if (d.toDateString() === new Date().toDateString()) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

export function TicketsClient({
  isAdmin,
  tickets,
  selected,
  messages,
  showNew,
  leads,
  presetLeadId,
}: {
  isAdmin: boolean
  tickets: TicketListItem[]
  selected: TicketListItem | null
  messages: TicketMessage[]
  showNew: boolean
  leads: LeadOption[]
  presetLeadId: string | null
}) {
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<"all" | TicketStatus>(isAdmin ? "open" : "all")

  // New answers and tickets show up without a reload.
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 15_000)
    return () => clearInterval(id)
  }, [router])

  const filtered = tickets.filter((t) => {
    if (filter !== "all" && t.status !== filter) return false
    if (!search) return true
    const q = search.toLowerCase()
    return t.subject.toLowerCase().includes(q) || t.agentName.toLowerCase().includes(q) || (t.leadLabel ?? "").toLowerCase().includes(q)
  })
  const openCount = tickets.filter((t) => t.status === "open").length
  const panelOpen = showNew || !!selected

  return (
    <div className="flex h-full border-t">
      {/* List */}
      <div className={`w-full shrink-0 flex-col border-r md:flex md:w-80 ${panelOpen ? "hidden" : "flex"}`}>
        <div className="p-3 border-b space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-sm font-semibold">{isAdmin ? "Support tickets" : "My tickets"}</h1>
            {!isAdmin && (
              <Button size="sm" className="h-8 gap-1.5" nativeButton={false} render={<Link href="/tickets?new=1" />}>
                <Plus className="size-3.5" />
                New ticket
              </Button>
            )}
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input placeholder="Search tickets…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-8 text-sm" />
          </div>
          <div className="flex gap-1 text-xs">
            {(["all", "open", "answered", "closed"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`rounded-md px-2 py-1 transition-colors duration-150 ${filter === f ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {f === "all" ? "All" : f === "open" ? `Waiting${openCount ? ` (${openCount})` : ""}` : STATUS_LABEL[f]}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="py-14 flex flex-col items-center gap-2.5 text-center px-4">
              <LifeBuoy className="size-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                {tickets.length === 0 ? (isAdmin ? "No tickets yet." : "No tickets yet. Have a question? Raise a ticket.") : "No matches."}
              </p>
            </div>
          ) : (
            filtered.map((t) => {
              const active = t.id === selected?.id
              const unread = isAdmin ? t.status === "open" : t.agentUnread
              return (
                <Link
                  key={t.id}
                  href={`/tickets?t=${t.id}`}
                  className={`block border-b px-3 py-3 transition-colors duration-150 ease-[var(--ease-out)] hover:bg-muted/40 ${active ? "bg-accent" : ""}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className={`text-sm truncate ${unread ? "font-semibold" : "font-medium"}`}>{t.subject}</p>
                    <span className="text-[11px] text-muted-foreground shrink-0">{when(t.lastMessageAt)}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground truncate">
                      {isAdmin ? `${t.agentName} · ` : ""}
                      {t.leadLabel ?? TOPIC_LABEL[t.topic]}
                    </p>
                    <StatusPill status={t.status} />
                  </div>
                </Link>
              )
            })
          )}
        </div>
      </div>

      {/* Detail / new */}
      <div className={`min-w-0 flex-1 flex-col md:flex ${panelOpen ? "flex" : "hidden"}`}>
        {showNew ? (
          <NewTicketForm leads={leads} presetLeadId={presetLeadId} />
        ) : selected ? (
          <TicketThread ticket={selected} messages={messages} isAdmin={isAdmin} />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-4">
            <LifeBuoy className="size-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">
              {isAdmin ? "Select a ticket to answer it." : "Select a ticket, or raise a new one."}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function BackLink() {
  return (
    <Link
      href="/tickets"
      aria-label="Back to tickets"
      className="-ml-1 flex size-9 shrink-0 items-center justify-center rounded-md hover:bg-muted md:hidden"
    >
      <ArrowLeft className="size-4" />
    </Link>
  )
}

function NewTicketForm({ leads, presetLeadId }: { leads: LeadOption[]; presetLeadId: string | null }) {
  const router = useRouter()
  const preset = presetLeadId && leads.some((l) => l.id === presetLeadId) ? presetLeadId : null
  const [topic, setTopic] = useState<TicketTopic>(preset ? "client" : "own")
  const [leadId, setLeadId] = useState<string>(preset ?? "")
  const [leadSearch, setLeadSearch] = useState("")
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [sending, setSending] = useState(false)

  const shownLeads = useMemo(() => {
    const q = leadSearch.trim().toLowerCase()
    const list = q ? leads.filter((l) => l.label.toLowerCase().includes(q)) : leads
    // Keep the chosen lead in the list even when the search hides it.
    const chosen = leads.find((l) => l.id === leadId)
    const top = list.slice(0, 200)
    return chosen && !top.includes(chosen) ? [chosen, ...top] : top
  }, [leads, leadSearch, leadId])

  async function submit() {
    if (sending) return
    setSending(true)
    const { error, ticketId } = await createTicket({ topic, subject, body, leadId: topic === "client" ? leadId || null : null })
    setSending(false)
    if (error) {
      toast.error(error)
      return
    }
    toast.success("Ticket sent to the admin")
    router.push(`/tickets?t=${ticketId}`)
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex items-center gap-2 px-3 sm:px-4 py-3 border-b">
        <BackLink />
        <h2 className="text-sm font-semibold">New ticket</h2>
      </div>
      <div className="max-w-xl p-4 space-y-4">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">What is it about?</legend>
          <div className="flex flex-wrap gap-2">
            {(["client", "own"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTopic(t)}
                aria-pressed={topic === t}
                className={`rounded-md border px-3 py-1.5 text-sm transition-colors duration-150 ${topic === t ? "border-primary bg-primary/10 font-medium" : "hover:bg-muted"}`}
              >
                {TOPIC_LABEL[t]}
              </button>
            ))}
          </div>
        </fieldset>

        {topic === "client" && (
          <div className="space-y-1.5">
            <label htmlFor="ticket-lead" className="text-sm font-medium">Client (lead)</label>
            <Input placeholder="Search your leads…" value={leadSearch} onChange={(e) => setLeadSearch(e.target.value)} className="h-8 text-sm" />
            <select
              id="ticket-lead"
              value={leadId}
              onChange={(e) => setLeadId(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Choose a lead…</option>
              {shownLeads.map((l) => (
                <option key={l.id} value={l.id}>{l.label}</option>
              ))}
            </select>
          </div>
        )}

        <div className="space-y-1.5">
          <label htmlFor="ticket-subject" className="text-sm font-medium">Subject</label>
          <Input
            id="ticket-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={SUBJECT_MAX}
            placeholder="e.g. Broker asks if we support QuickBooks Desktop"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="ticket-body" className="text-sm font-medium">Your question</label>
          <textarea
            id="ticket-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={BODY_MAX}
            rows={6}
            placeholder="Explain what you need help with…"
            className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
          />
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/tickets" />}>Cancel</Button>
          <Button size="sm" className="gap-1.5" onClick={submit} disabled={sending || !subject.trim() || !body.trim() || (topic === "client" && !leadId)}>
            <Send className="size-3.5" />
            {sending ? "Sending…" : "Send to admin"}
          </Button>
        </div>
      </div>
    </div>
  )
}

function TicketThread({ ticket, messages, isAdmin }: { ticket: TicketListItem; messages: TicketMessage[]; isAdmin: boolean }) {
  const router = useRouter()
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages.length, ticket.id])

  async function send() {
    if (!draft.trim() || busy) return
    setBusy(true)
    const { error } = await replyToTicket(ticket.id, draft)
    setBusy(false)
    if (error) toast.error(error)
    else {
      setDraft("")
      router.refresh()
    }
  }

  async function toggleClosed() {
    setBusy(true)
    const { error } = await setTicketClosed(ticket.id, ticket.status !== "closed")
    setBusy(false)
    if (error) toast.error(error)
    else router.refresh()
  }

  return (
    <>
      <div className="flex items-start gap-2 px-3 sm:px-4 py-3 border-b shrink-0">
        <BackLink />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-sm">{ticket.subject}</p>
            <StatusPill status={ticket.status} />
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {isAdmin ? `${ticket.agentName} · ` : ""}
            {TOPIC_LABEL[ticket.topic]}
            {ticket.leadId && ticket.leadLabel && (
              <>
                {" · "}
                <Link href={`/leads/${ticket.leadId}`} className="underline underline-offset-2 hover:text-foreground">
                  {ticket.leadLabel}
                </Link>
              </>
            )}
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5 shrink-0" onClick={toggleClosed} disabled={busy}>
          {ticket.status === "closed" ? <RotateCcw className="size-3.5" /> : <CheckCircle2 className="size-3.5" />}
          {ticket.status === "closed" ? "Reopen" : "Close"}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-muted/20">
        {messages.map((m) => {
          // "Mine" = on the right: the admin's answers for the admin, the agent's messages for the agent.
          const mine = m.fromAdmin === isAdmin
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[75%] flex flex-col gap-0.5 ${mine ? "items-end" : "items-start"}`}>
                <div
                  className={`rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                    mine ? "bg-blue-600 text-white rounded-br-sm" : "bg-card border text-foreground rounded-bl-sm"
                  }`}
                >
                  {m.body}
                </div>
                <span className="text-[11px] text-muted-foreground px-1">
                  {m.fromAdmin ? "Admin" : ticket.agentName} · {when(m.createdAt)}
                </span>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      <div className="border-t p-3 shrink-0 space-y-1.5">
        {ticket.status === "closed" && (
          <p className="text-xs text-muted-foreground">This ticket is closed. Replying reopens it.</p>
        )}
        <div className="flex gap-2 items-end">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            maxLength={BODY_MAX}
            placeholder={isAdmin ? "Write your answer… (Enter to send)" : "Write a reply… (Enter to send)"}
            rows={2}
            disabled={busy}
            className="flex-1 resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground disabled:opacity-50"
          />
          <Button size="sm" className="gap-1.5 shrink-0" onClick={send} disabled={!draft.trim() || busy}>
            <Send className="size-3.5" />
            {isAdmin ? "Answer" : "Send"}
          </Button>
        </div>
      </div>
    </>
  )
}
