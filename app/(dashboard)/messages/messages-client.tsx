"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Search, Send, UserPlus, MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase/client"
import { sendInboxSms, markConversationRead, addNumberAsLead } from "./actions"

const CHAR_LIMIT = 160

interface RawEvent {
  id: string
  lead_id: string | null
  direction: "inbound" | "outbound"
  message_body: string | null
  status: string
  occurred_at: string
  from_number: string | null
  to_number: string | null
  read_at: string | null
  leads: {
    id: string
    brokers: { company_name: string; contact_name: string | null; phone: string | null } | null
  } | null
}

interface Conversation {
  number: string
  leadId: string | null
  displayName: string
  lastMessage: string
  lastAt: string
  unreadCount: number
  events: RawEvent[]
}

function counterpartyNumber(e: RawEvent): string | null {
  return e.direction === "inbound" ? e.from_number : e.to_number
}

function buildConversations(events: RawEvent[]): Conversation[] {
  const map = new Map<string, RawEvent[]>()
  for (const e of events) {
    const num = counterpartyNumber(e) ?? e.leads?.brokers?.phone ?? null
    if (!num) continue
    const arr = map.get(num) ?? []
    arr.push(e)
    map.set(num, arr)
  }
  return [...map.entries()]
    .map(([number, evs]) => {
      const sorted = evs.slice().sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
      const last = sorted[sorted.length - 1]
      const withLead = sorted.find((e) => e.leads)
      const broker = withLead?.leads?.brokers
      return {
        number,
        leadId: withLead?.lead_id ?? null,
        displayName: broker?.company_name || broker?.contact_name || number,
        lastMessage: last.message_body ?? "",
        lastAt: last.occurred_at,
        unreadCount: sorted.filter((e) => e.direction === "inbound" && !e.read_at).length,
        events: sorted,
      }
    })
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt))
}

function timeLabel(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function requestNotificationPermission() {
  if (typeof window === "undefined" || !("Notification" in window)) return
  if (Notification.permission === "default") Notification.requestPermission()
}

function notifyNewSms(body: string | null, from: string | null) {
  if (typeof window === "undefined" || !("Notification" in window)) return
  if (Notification.permission !== "granted") return
  try {
    new Notification(`New SMS from ${from ?? "unknown number"}`, { body: body ?? "" })
  } catch {
    // Notification constructor can throw in some contexts (e.g. no service worker); ignore.
  }
}

const SELECT = `
  id, lead_id, direction, message_body, status, occurred_at,
  from_number, to_number, read_at,
  leads ( id, brokers ( company_name, contact_name, phone ) )
`

export function MessagesClient({ initialEvents }: { initialEvents: RawEvent[] }) {
  const [events, setEvents] = useState<RawEvent[]>(initialEvents)
  const [search, setSearch] = useState("")
  const [selectedNumber, setSelectedNumber] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [addingLead, setAddingLead] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const seenIdsRef = useRef<Set<string>>(new Set(initialEvents.map((e) => e.id)))

  const conversations = useMemo(() => buildConversations(events), [events])
  const filtered = conversations.filter((c) => {
    if (!search) return true
    const q = search.toLowerCase()
    return c.displayName.toLowerCase().includes(q) || c.number.includes(q)
  })
  const selected = conversations.find((c) => c.number === selectedNumber) ?? null

  async function refetch() {
    const supabase = createClient()
    const { data } = await supabase
      .from("outreach_events")
      .select(SELECT)
      .eq("channel", "sms")
      .order("occurred_at", { ascending: true })
    if (!data) return

    // Notify on anything new we haven't rendered yet, regardless of whether
    // it arrived via the realtime push or the polling fallback below.
    for (const e of data as unknown as RawEvent[]) {
      if (!seenIdsRef.current.has(e.id)) {
        seenIdsRef.current.add(e.id)
        if (e.direction === "inbound") notifyNewSms(e.message_body, e.from_number)
      }
    }
    setEvents(data as unknown as RawEvent[])
  }

  useEffect(() => {
    requestNotificationPermission()
    const supabase = createClient()
    const channel = supabase
      .channel("messages-inbox")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "outreach_events", filter: "channel=eq.sms" },
        () => refetch(),
      )
      .subscribe()

    // Realtime push is the fast path; poll as a fallback so the inbox still
    // updates within a few seconds if a push is ever missed or delayed.
    const poll = setInterval(refetch, 8000)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(poll)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [selected?.events.length])

  function selectConversation(number: string) {
    setSelectedNumber(number)
    const convo = conversations.find((c) => c.number === number)
    if (convo && convo.unreadCount > 0) {
      setEvents((prev) =>
        prev.map((e) =>
          e.direction === "inbound" && counterpartyNumber(e) === number && !e.read_at
            ? { ...e, read_at: new Date().toISOString() }
            : e,
        ),
      )
      markConversationRead(number)
    }
  }

  async function handleSend() {
    if (!selected || !draft.trim() || sending) return
    const text = draft.trim()
    setDraft("")
    setSending(true)

    const optimistic: RawEvent = {
      id: `optimistic-${Date.now()}`,
      lead_id: selected.leadId,
      direction: "outbound",
      message_body: text,
      status: "sending",
      occurred_at: new Date().toISOString(),
      from_number: null,
      to_number: selected.number,
      read_at: null,
      leads: null,
    }
    setEvents((prev) => [...prev, optimistic])

    const { error } = await sendInboxSms(selected.number, text, selected.leadId)
    if (error) {
      toast.error(`Failed to send: ${error}`)
      setEvents((prev) => prev.filter((e) => e.id !== optimistic.id))
      setDraft(text)
    } else {
      refetch()
    }
    setSending(false)
  }

  async function handleAddAsLead() {
    if (!selected) return
    setAddingLead(true)
    const { error } = await addNumberAsLead(selected.number)
    if (error) toast.error(`Failed to add lead: ${error}`)
    else {
      toast.success("Lead created")
      await refetch()
    }
    setAddingLead(false)
  }

  return (
    <div className="flex h-full border-t">
      {/* Left panel — conversation list */}
      <div className="w-80 shrink-0 border-r flex flex-col">
        <div className="p-3 border-b">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              placeholder="Search name or number…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="py-14 flex flex-col items-center gap-2.5 text-center px-4">
              <MessageSquare className="size-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                {conversations.length === 0 ? "No SMS conversations yet." : "No matches."}
              </p>
            </div>
          ) : (
            filtered.map((c) => {
              const isActive = c.number === selectedNumber
              const unread = c.unreadCount > 0
              return (
                <button
                  key={c.number}
                  onClick={() => selectConversation(c.number)}
                  className={`w-full flex items-start gap-2.5 px-3 py-3 border-b text-left transition-colors duration-150 ease-[var(--ease-out)] hover:bg-muted/40 ${
                    isActive ? "bg-accent" : ""
                  }`}
                >
                  <div className="size-9 rounded-full bg-muted flex items-center justify-center shrink-0 text-sm font-medium">
                    {c.displayName.trim()[0]?.toUpperCase() ?? "#"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className={`text-sm truncate ${unread ? "font-semibold" : "font-medium"}`}>
                        {c.displayName}
                      </p>
                      <span className="text-[11px] text-muted-foreground shrink-0">{timeLabel(c.lastAt)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <p className={`text-xs truncate ${unread ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                        {c.lastMessage || "—"}
                      </p>
                      {unread && (
                        <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-semibold flex items-center justify-center">
                          {c.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* Right panel — chat window */}
      <div className="flex-1 flex flex-col min-w-0">
        {!selected ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-4">
            <MessageSquare className="size-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">Select a conversation to view messages.</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b shrink-0">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-sm truncate">{selected.displayName}</p>
                  {!selected.leadId && <Badge variant="outline" className="text-[10px]">Unknown</Badge>}
                </div>
                <p className="text-xs text-muted-foreground font-mono">{selected.number}</p>
              </div>
              {!selected.leadId && (
                <Button size="sm" variant="outline" className="gap-1.5 shrink-0" onClick={handleAddAsLead} disabled={addingLead}>
                  <UserPlus className="size-3.5" />
                  {addingLead ? "Adding…" : "Add as Lead"}
                </Button>
              )}
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2 bg-muted/20">
              {selected.events.map((ev) => {
                const isOutbound = ev.direction === "outbound"
                return (
                  <div key={ev.id} className={`flex ${isOutbound ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[70%] flex flex-col gap-0.5 ${isOutbound ? "items-end" : "items-start"}`}>
                      <div
                        className={`rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                          isOutbound
                            ? "bg-blue-600 text-white rounded-br-sm"
                            : "bg-muted text-foreground rounded-bl-sm"
                        }`}
                      >
                        {ev.message_body}
                      </div>
                      <span className="text-[11px] text-muted-foreground px-1">
                        {timeLabel(ev.occurred_at)}
                      </span>
                    </div>
                  </div>
                )
              })}
              <div ref={bottomRef} />
            </div>

            {/* Composer */}
            <div className="border-t p-3 shrink-0 space-y-1.5">
              <div className="flex gap-2 items-end">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault()
                      handleSend()
                    }
                  }}
                  placeholder="Type a reply… (Enter to send)"
                  rows={2}
                  disabled={sending}
                  className="flex-1 resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground disabled:opacity-50"
                />
                <Button size="sm" className="gap-1.5 shrink-0" onClick={handleSend} disabled={!draft.trim() || sending}>
                  <Send className="size-3.5" />
                  Send
                </Button>
              </div>
              <p className={`text-[11px] text-right ${draft.length > CHAR_LIMIT ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                {draft.length}/{CHAR_LIMIT}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
