"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Search, Send, UserPlus, Mail, RefreshCw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase/client"
import { sendEmailReply, markEmailsRead, addSenderAsLead, syncEmailNow, deleteEmailEvents } from "./actions"

interface RawEvent {
  id: string
  lead_id: string | null
  direction: "inbound" | "outbound"
  status: string
  subject: string | null
  message_body: string | null
  from_email: string | null
  to_email: string | null
  message_id: string | null
  send_error: string | null
  read_at: string | null
  occurred_at: string
  leads: {
    id: string
    brokers: { company_name: string; contact_name: string | null } | null
  } | null
}

interface Thread {
  key: string
  leadId: string | null
  displayName: string
  subject: string
  counterparty: string
  lastPreview: string
  lastAt: string
  unreadCount: number
  events: RawEvent[]
  replyParent: RawEvent | null
}

const SELECT = `
  id, lead_id, direction, status, subject, message_body, from_email, to_email,
  message_id, send_error, read_at, occurred_at,
  leads ( id, brokers ( company_name, contact_name ) )
`

function normalizeSubject(s: string | null): string {
  return (s ?? "").replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, "").trim().toLowerCase()
}

// Replies carry the whole quoted history — show just the new part. The raw
// text is still stored in full; this is display only.
function stripQuoted(text: string): string {
  const cuts: number[] = []
  const wrote = text.match(/\r?\n?On [\s\S]{0,300}?wrote:/)
  if (wrote?.index !== undefined) cuts.push(wrote.index)
  const orig = text.search(/\r?\n-{2,}\s*Original Message/i)
  if (orig >= 0) cuts.push(orig)
  const quoted = text.search(/(^|\n)>/)
  if (quoted >= 0) cuts.push(quoted)
  if (cuts.length === 0) return text
  const trimmed = text.slice(0, Math.min(...cuts)).trim()
  return trimmed || text
}

function counterpartyOf(e: RawEvent): string | null {
  return e.direction === "inbound" ? e.from_email : e.to_email
}

function buildThreads(events: RawEvent[]): Thread[] {
  const map = new Map<string, RawEvent[]>()
  for (const e of events) {
    const cp = counterpartyOf(e)
    // Legacy outbound rows pre-date to_email; they can still be placed by lead.
    if (!cp && !e.lead_id) continue
    const key = `${e.lead_id ?? `x:${cp}`}|${normalizeSubject(e.subject)}`
    const arr = map.get(key) ?? []
    arr.push(e)
    map.set(key, arr)
  }

  return [...map.entries()]
    .map(([key, evs]) => {
      const sorted = evs.slice().sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
      const last = sorted[sorted.length - 1]
      const withLead = sorted.find((e) => e.leads)
      const broker = withLead?.leads?.brokers
      const lastInbound = [...sorted].reverse().find((e) => e.direction === "inbound")
      const lastReplyable = [...sorted].reverse().find((e) => e.direction === "outbound" && e.to_email)
      // Show (and reply to) whoever actually wrote last — a broker can answer
      // from a different address than the one we emailed.
      const counterparty =
        counterpartyOf(lastInbound ?? lastReplyable ?? sorted[0]) ??
        sorted.map(counterpartyOf).find((x) => !!x) ??
        ""
      return {
        key,
        leadId: withLead?.lead_id ?? null,
        displayName: broker?.company_name || broker?.contact_name || counterparty || "Unknown",
        subject: sorted.find((e) => e.subject)?.subject ?? "(no subject)",
        counterparty,
        lastPreview: stripQuoted(last.message_body ?? "").replace(/\s+/g, " ").slice(0, 120),
        lastAt: last.occurred_at,
        unreadCount: sorted.filter((e) => e.direction === "inbound" && !e.read_at).length,
        events: sorted,
        replyParent: lastInbound ?? lastReplyable ?? null,
      }
    })
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt))
}

function timeLabel(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

export function EmailsClient({
  initialEvents,
  isAdmin,
  imapConfigured,
  lastSyncedAt,
  lastSyncError,
}: {
  initialEvents: RawEvent[]
  isAdmin: boolean
  imapConfigured: boolean
  lastSyncedAt: string | null
  lastSyncError: string | null
}) {
  const [events, setEvents] = useState<RawEvent[]>(initialEvents)
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<"all" | "unmatched">("all")
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [addingLead, setAddingLead] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // Conversations ticked for bulk delete (admin only), by thread key.
  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(new Set())
  const bottomRef = useRef<HTMLDivElement>(null)

  const threads = useMemo(() => buildThreads(events), [events])
  const unmatchedCount = threads.filter((t) => !t.leadId).length
  const filtered = threads.filter((t) => {
    if (filter === "unmatched" && t.leadId) return false
    if (!search) return true
    const q = search.toLowerCase()
    return (
      t.displayName.toLowerCase().includes(q) ||
      t.subject.toLowerCase().includes(q) ||
      t.counterparty.toLowerCase().includes(q)
    )
  })
  const selected = threads.find((t) => t.key === selectedKey) ?? null

  async function refetch() {
    const supabase = createClient()
    const { data } = await supabase
      .from("outreach_events")
      .select(SELECT)
      .eq("channel", "email")
      .order("occurred_at", { ascending: true })
    if (data) setEvents(data as unknown as RawEvent[])
  }

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel("emails-inbox")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "outreach_events", filter: "channel=eq.email" },
        () => refetch(),
      )
      .subscribe()
    // Realtime is the fast path; poll as a fallback so new mail still shows up
    // within seconds if a push is missed.
    const poll = setInterval(refetch, 10_000)
    return () => {
      supabase.removeChannel(channel)
      clearInterval(poll)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [selected?.events.length])

  function selectThread(t: Thread) {
    setSelectedKey(t.key)
    const unreadIds = t.events.filter((e) => e.direction === "inbound" && !e.read_at).map((e) => e.id)
    if (unreadIds.length > 0) {
      const now = new Date().toISOString()
      setEvents((prev) => prev.map((e) => (unreadIds.includes(e.id) ? { ...e, read_at: now } : e)))
      markEmailsRead(unreadIds)
    }
  }

  async function handleSend() {
    if (!selected?.replyParent || !draft.trim() || sending) return
    const text = draft.trim()
    setSending(true)
    const { error } = await sendEmailReply(selected.replyParent.id, text)
    if (error) {
      toast.error(`Failed to send: ${error}`)
    } else {
      setDraft("")
      toast.success("Reply sent")
    }
    await refetch()
    setSending(false)
  }

  async function handleAddAsLead() {
    if (!selected) return
    setAddingLead(true)
    const { error } = await addSenderAsLead(selected.counterparty, null)
    if (error) toast.error(`Failed to add lead: ${error}`)
    else {
      toast.success("Lead created")
      await refetch()
    }
    setAddingLead(false)
  }

  async function handleDelete() {
    if (!selected || deleting) return
    const n = selected.events.length
    const ok = window.confirm(
      `Delete this conversation (${n} message${n === 1 ? "" : "s"}) from the CRM?

It is only removed here, not from the mailbox. This cannot be undone.`,
    )
    if (!ok) return
    setDeleting(true)
    const ids = selected.events.map((e) => e.id)
    const { error, deleted } = await deleteEmailEvents(ids)
    if (error) toast.error(`Failed to delete: ${error}`)
    else {
      toast.success(`Deleted ${deleted} message${deleted === 1 ? "" : "s"}`)
      setEvents((prev) => prev.filter((e) => !ids.includes(e.id)))
      setSelectedKey(null)
    }
    setDeleting(false)
  }

  const checkedThreads = filtered.filter((t) => checkedKeys.has(t.key))
  const allFilteredChecked = filtered.length > 0 && filtered.every((t) => checkedKeys.has(t.key))

  function toggleChecked(key: string) {
    setCheckedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function handleDeleteChecked() {
    if (checkedThreads.length === 0 || deleting) return
    const ids = checkedThreads.flatMap((t) => t.events.map((e) => e.id))
    const ok = window.confirm(
      `Delete ${checkedThreads.length} conversation${checkedThreads.length === 1 ? "" : "s"} (${ids.length} message${ids.length === 1 ? "" : "s"}) from the CRM?

They are only removed here, not from the mailbox. This cannot be undone.`,
    )
    if (!ok) return
    setDeleting(true)
    const { error, deleted } = await deleteEmailEvents(ids)
    if (error) toast.error(`Failed to delete: ${error}`)
    else {
      toast.success(`Deleted ${deleted} message${deleted === 1 ? "" : "s"}`)
      setEvents((prev) => prev.filter((e) => !ids.includes(e.id)))
      if (selectedKey && checkedKeys.has(selectedKey)) setSelectedKey(null)
      setCheckedKeys(new Set())
    }
    setDeleting(false)
  }

  async function handleSync() {
    setSyncing(true)
    const r = await syncEmailNow()
    if (r.error) toast.error(`Sync failed: ${r.error}`)
    else if (r.throttled) {
      toast.success("Already up to date — synced a moment ago.")
      await refetch()
    } else if (r.baselined) {
      toast.success("Sync started — only emails that arrive from now on will be imported.")
      await refetch()
    } else {
      toast.success(
        `Synced — ${r.imported} new${r.remaining ? `, ${r.remaining} more waiting (sync again)` : ""}`,
      )
      await refetch()
    }
    setSyncing(false)
  }

  return (
    <div className="flex h-full border-t">
      {/* Left — thread list */}
      <div className="w-96 shrink-0 border-r flex flex-col">
        <div className="p-3 border-b space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              placeholder="Search name, subject or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>
          <div className="flex items-center gap-1.5">
            {/* Unmatched mail has no lead, so only admins ever see it. */}
            {isAdmin && (
              <>
                <Button
                  variant={filter === "all" ? "default" : "ghost"}
                  size="sm"
                  className="h-7 text-xs px-2.5"
                  onClick={() => setFilter("all")}
                >
                  All
                </Button>
                <Button
                  variant={filter === "unmatched" ? "default" : "ghost"}
                  size="sm"
                  className="h-7 text-xs px-2.5"
                  onClick={() => setFilter("unmatched")}
                >
                  Unmatched{unmatchedCount > 0 ? ` (${unmatchedCount})` : ""}
                </Button>
              </>
            )}
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs px-2.5 gap-1.5 ml-auto"
              onClick={handleSync}
              disabled={syncing || !imapConfigured}
              title={imapConfigured ? "Fetch new mail now" : "Email sync isn't set up"}
            >
              <RefreshCw className={`size-3 ${syncing ? "animate-spin" : ""}`} />
              Sync now
            </Button>
          </div>
          {isAdmin && filtered.length > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <label className="flex cursor-pointer items-center gap-1.5 text-muted-foreground">
                <input
                  type="checkbox"
                  className="size-3.5 cursor-pointer"
                  checked={allFilteredChecked}
                  onChange={() =>
                    setCheckedKeys(allFilteredChecked ? new Set() : new Set(filtered.map((t) => t.key)))
                  }
                />
                Select all
              </label>
              {checkedThreads.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto h-7 gap-1.5 px-2.5 text-xs text-destructive hover:text-destructive"
                  onClick={handleDeleteChecked}
                  disabled={deleting}
                >
                  <Trash2 className="size-3" />
                  {deleting ? "Deleting…" : `Delete (${checkedThreads.length})`}
                </Button>
              )}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            {!imapConfigured
              ? isAdmin
                ? "IMAP isn't configured — set IMAP_HOST, IMAP_USER, IMAP_PASS."
                : "Email sync isn't set up yet — ask an admin."
              : lastSyncError
                ? `Last sync failed: ${lastSyncError}`
                : lastSyncedAt
                  ? `Last synced ${new Date(lastSyncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                  : "Not synced yet."}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="py-14 flex flex-col items-center gap-2.5 text-center px-4">
              <Mail className="size-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                {threads.length === 0 ? "No email conversations yet." : "No matches."}
              </p>
            </div>
          ) : (
            filtered.map((t) => {
              const unread = t.unreadCount > 0
              return (
                <div
                  key={t.key}
                  className={`flex items-start border-b transition-colors duration-150 ease-[var(--ease-out)] hover:bg-muted/40 ${
                    t.key === selectedKey ? "bg-accent" : checkedKeys.has(t.key) ? "bg-accent/40" : ""
                  }`}
                >
                {isAdmin && (
                  <label className="-mr-1 flex cursor-pointer items-center self-stretch pl-3 pr-1">
                    <input
                      type="checkbox"
                      className="size-3.5 cursor-pointer"
                      checked={checkedKeys.has(t.key)}
                      onChange={() => toggleChecked(t.key)}
                      aria-label={`Select ${t.displayName}`}
                    />
                  </label>
                )}
                <button
                  onClick={() => selectThread(t)}
                  className="flex min-w-0 flex-1 items-start gap-2.5 px-3 py-3 text-left"
                >
                  <div className="size-9 rounded-full bg-muted flex items-center justify-center shrink-0 text-sm font-medium">
                    {t.displayName.trim()[0]?.toUpperCase() ?? "#"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className={`text-sm truncate ${unread ? "font-semibold" : "font-medium"}`}>
                        {t.displayName}
                      </p>
                      <span className="text-[11px] text-muted-foreground shrink-0">{timeLabel(t.lastAt)}</span>
                    </div>
                    <p className={`text-xs truncate ${unread ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                      {t.subject}
                    </p>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <p className="text-xs truncate text-muted-foreground">{t.lastPreview || "—"}</p>
                      {unread && (
                        <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-semibold flex items-center justify-center">
                          {t.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Right — thread */}
      <div className="flex-1 flex flex-col min-w-0">
        {!selected ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-4">
            <Mail className="size-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">Select a conversation to read it.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b shrink-0">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-sm truncate">{selected.subject}</p>
                  {!selected.leadId && <Badge variant="outline" className="text-[10px]">Unmatched</Badge>}
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {selected.displayName}
                  {selected.counterparty && selected.displayName !== selected.counterparty
                    ? ` · ${selected.counterparty}`
                    : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
              {isAdmin && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 shrink-0 text-destructive hover:text-destructive"
                  onClick={handleDelete}
                  disabled={deleting}
                  title="Delete this conversation from the CRM (not from the mailbox)"
                >
                  <Trash2 className="size-3.5" />
                  {deleting ? "Deleting…" : "Delete"}
                </Button>
              )}
              {isAdmin && !selected.leadId && selected.counterparty && (
                <Button size="sm" variant="outline" className="gap-1.5 shrink-0" onClick={handleAddAsLead} disabled={addingLead}>
                  <UserPlus className="size-3.5" />
                  {addingLead ? "Adding…" : "Add as Lead"}
                </Button>
              )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-muted/20">
              {selected.events.map((ev) => {
                const out = ev.direction === "outbound"
                const text = out ? ev.message_body : stripQuoted(ev.message_body ?? "")
                return (
                  <div key={ev.id} className={`flex ${out ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[75%] flex flex-col gap-0.5 ${out ? "items-end" : "items-start"}`}>
                      <div
                        className={`rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap break-words ${
                          out ? "bg-blue-600 text-white rounded-br-sm" : "bg-muted text-foreground rounded-bl-sm"
                        }`}
                      >
                        {text || <span className="italic opacity-70">(empty message)</span>}
                      </div>
                      <span className="text-[11px] text-muted-foreground px-1">
                        {out ? "You" : (ev.from_email ?? "Broker")} · {timeLabel(ev.occurred_at)}
                        {out && ev.status === "failed" && (
                          <span className="text-destructive" title={ev.send_error ?? undefined}> · Failed to send</span>
                        )}
                      </span>
                    </div>
                  </div>
                )
              })}
              <div ref={bottomRef} />
            </div>

            <div className="border-t p-3 shrink-0">
              {selected.replyParent ? (
                <div className="flex gap-2 items-end">
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={`Reply to ${selected.counterparty || "sender"}…`}
                    rows={3}
                    disabled={sending}
                    className="flex-1 resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground disabled:opacity-50"
                  />
                  <Button size="sm" className="gap-1.5 shrink-0" onClick={handleSend} disabled={!draft.trim() || sending}>
                    <Send className="size-3.5" />
                    {sending ? "Sending…" : "Send"}
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  There's no address on this thread to reply to.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
