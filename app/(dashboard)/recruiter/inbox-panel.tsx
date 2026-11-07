"use client"

import { useCallback, useEffect, useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Send, UserPlus, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { splitQuoted } from "@/lib/recruiter/mime"
import { renderTemplate } from "@/lib/recruiter/template"
import { createAgent } from "@/app/(dashboard)/agents/actions"
import { linkHiredRecruit, loadThread, saveRecruitNotes, sendRecruitReply, setRecruitStage } from "./actions"
import { MediaCard } from "./media-card"
import { StageBadge } from "./stage-badge"
import { RECRUIT_STAGES, STAGE_LABEL, type Recruit, type RecruitStage, type RecruitTemplate, type ThreadData } from "./types"

type Filter = "all" | "replied" | "no_reply" | "follow_up"

export function InboxPanel({ recruits, templates, smtpReady }: { recruits: Recruit[]; templates: RecruitTemplate[]; smtpReady: boolean }) {
  const [filter, setFilter] = useState<Filter>("replied")
  const [q, setQ] = useState("")
  const [activeId, setActiveId] = useState<string | null>(null)
  const [readIds, setReadIds] = useState<Set<string>>(new Set())

  const list = useMemo(() => {
    const now = Date.now()
    const s = q.trim().toLowerCase()
    return recruits
      .filter((r) => {
        if (s && !r.name.toLowerCase().includes(s) && !r.email.includes(s)) return false
        if (filter === "replied") return !!r.last_reply_at
        if (filter === "no_reply") return !!r.last_emailed_at && !r.last_reply_at
        if (filter === "follow_up") return !r.last_reply_at && !!r.follow_up_due_at && new Date(r.follow_up_due_at).getTime() <= now
        return true
      })
      .sort((a, b) => (b.last_reply_at ?? b.last_emailed_at ?? b.created_at).localeCompare(a.last_reply_at ?? a.last_emailed_at ?? a.created_at))
  }, [recruits, filter, q])

  const active = recruits.find((r) => r.id === activeId) ?? null

  return (
    <div className="grid md:grid-cols-[300px_1fr] gap-3 min-h-[60vh]">
      <div className={cn("rounded-lg border bg-card flex flex-col min-h-0", active && "hidden md:flex")}>
        <div className="p-2 space-y-2 border-b">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="h-8 text-sm" />
          <div className="flex flex-wrap gap-1">
            {(
              [
                ["replied", "Replied"],
                ["no_reply", "No reply"],
                ["follow_up", "Follow-up due"],
                ["all", "All"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setFilter(id)}
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-xs border transition-colors duration-150",
                  filter === id ? "bg-foreground text-background border-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <ul className="flex-1 overflow-y-auto max-h-[70vh]">
          {list.length === 0 && <li className="p-6 text-center text-xs text-muted-foreground">Nothing here.</li>}
          {list.slice(0, 500).map((r) => {
            const unread = r.unread && !readIds.has(r.id)
            return (
              <li key={r.id}>
                <button
                  onClick={() => {
                    setActiveId(r.id)
                    setReadIds((s) => new Set(s).add(r.id))
                  }}
                  className={cn(
                    "w-full text-left px-3 py-2.5 border-b flex items-start gap-2 transition-colors duration-150 hover:bg-muted/50",
                    activeId === r.id && "bg-muted",
                  )}
                >
                  <span className={cn("mt-1.5 size-2 rounded-full shrink-0", unread ? "bg-primary" : "bg-transparent")} aria-label={unread ? "Unread" : undefined} />
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-sm truncate", unread && "font-semibold")}>{r.name || r.email}</span>
                    <span className="block text-xs text-muted-foreground truncate">{r.email}</span>
                  </span>
                  <StageBadge stage={r.stage} />
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      <div className={cn("rounded-lg border bg-card min-h-0", !active && "hidden md:block")}>
        {active ? (
          <Thread key={active.id} recruit={active} templates={templates} smtpReady={smtpReady} onBack={() => setActiveId(null)} />
        ) : (
          <div className="h-full grid place-items-center p-10 text-sm text-muted-foreground">Pick a recruit to see the conversation.</div>
        )}
      </div>
    </div>
  )
}

function Thread({ recruit, templates, smtpReady, onBack }: { recruit: Recruit; templates: RecruitTemplate[]; smtpReady: boolean; onBack: () => void }) {
  const [data, setData] = useState<ThreadData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stage, setStage] = useState<RecruitStage>(recruit.stage)
  const [notes, setNotes] = useState(recruit.notes ?? "")
  const [reply, setReply] = useState("")
  const [hireOpen, setHireOpen] = useState(false)
  const [sending, startSend] = useTransition()
  const router = useRouter()

  const load = useCallback(async () => {
    const r = await loadThread(recruit.id)
    if ("error" in r) setError(r.error)
    else {
      setData(r)
      setStage(r.recruit.stage)
      setNotes(r.recruit.notes ?? "")
    }
  }, [recruit.id])
  useEffect(() => {
    load()
  }, [load])

  async function changeStage(s: RecruitStage) {
    setStage(s)
    const r = await setRecruitStage(recruit.id, s)
    if (r.error) toast.error(r.error)
    else router.refresh()
  }

  function send() {
    const lastSubject = [...(data?.messages ?? [])].reverse().find((m) => m.subject)?.subject ?? ""
    startSend(async () => {
      const r = await sendRecruitReply(recruit.id, lastSubject, reply)
      if (r.error) toast.error(r.error)
      else {
        toast.success("Reply sent")
        setReply("")
        await load()
        router.refresh()
      }
    })
  }

  const mediaBy = useMemo(() => {
    const m = new Map<string, ThreadData["media"]>()
    for (const x of data?.media ?? []) m.set(x.message_id, [...(m.get(x.message_id) ?? []), x])
    return m
  }, [data])

  return (
    <div className="flex flex-col h-full max-h-[80vh]">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b">
        <button onClick={onBack} className="md:hidden text-muted-foreground" aria-label="Back">
          <X className="size-4" />
        </button>
        <div className="min-w-0 mr-auto">
          <p className="text-sm font-semibold truncate">{recruit.name || recruit.email}</p>
          <p className="text-xs text-muted-foreground truncate">{recruit.email}</p>
        </div>
        <select value={stage} onChange={(e) => changeStage(e.target.value as RecruitStage)} className="h-8 rounded-lg border bg-background px-2 text-sm" aria-label="Stage">
          {RECRUIT_STAGES.map((s) => (
            <option key={s} value={s}>{STAGE_LABEL[s]}</option>
          ))}
        </select>
        {recruit.agent_id || stage === "hired" ? (
          <span className="text-xs text-emerald-600 font-medium">{recruit.agent_id ? "Agent account linked" : "Hired"}</span>
        ) : (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setHireOpen(true)}>
            <UserPlus className="size-3.5" /> Hire → create agent account
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 bg-muted/20">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!data && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
        {data && data.messages.length === 0 && <p className="text-sm text-muted-foreground">No emails yet.</p>}
        {data?.messages.map((m) => (
          <Bubble key={m.id} m={m} media={mediaBy.get(m.id) ?? []} />
        ))}
      </div>

      <div className="border-t p-3 space-y-2">
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Notes</summary>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={async () => {
              const r = await saveRecruitNotes(recruit.id, notes)
              if (r.error) toast.error(r.error)
            }}
            rows={3}
            className="mt-2 text-sm"
            placeholder="Private notes about this candidate (saved when you click away)"
          />
        </details>
        <div className="flex items-center gap-2">
          <select
            value=""
            onChange={(e) => {
              const t = templates.find((x) => x.id === e.target.value)
              if (t) setReply(renderTemplate(t.body, recruit))
            }}
            className="h-8 rounded-lg border bg-background px-2 text-xs"
            aria-label="Insert template"
          >
            <option value="">Insert template…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <span className="text-[11px] text-muted-foreground">Sent from info@loadlinkers.co in the same email thread</span>
        </div>
        <div className="flex gap-2">
          <Textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={3} placeholder="Write a reply…" className="text-sm" />
          <Button onClick={send} disabled={sending || !reply.trim() || !smtpReady} className="self-end gap-1.5" size="sm">
            <Send className="size-3.5" /> {sending ? "Sending…" : "Send"}
          </Button>
        </div>
      </div>

      {hireOpen && (
        <HireDialog
          recruit={recruit}
          onClose={() => setHireOpen(false)}
          onHired={async () => {
            setHireOpen(false)
            setStage("hired")
            await load()
            router.refresh()
          }}
        />
      )}
    </div>
  )
}

function Bubble({ m, media }: { m: ThreadData["messages"][number]; media: ThreadData["media"] }) {
  const out = m.direction === "outbound"
  const { fresh, quoted } = splitQuoted(m.body_text ?? "")
  const when = m.sent_at ?? m.received_at ?? m.created_at
  return (
    <div className={cn("flex", out ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[85%] space-y-2", out && "items-end")}>
        <div className={cn("rounded-xl px-3.5 py-2.5 text-sm shadow-xs", out ? "bg-primary text-primary-foreground" : "bg-card border")}>
          {m.subject && <p className={cn("text-xs font-medium mb-1", out ? "text-primary-foreground/80" : "text-muted-foreground")}>{m.subject}</p>}
          <p className="whitespace-pre-wrap break-words leading-relaxed">{fresh || <span className="opacity-60">(no text)</span>}</p>
          {quoted && (
            <details className="mt-2 text-xs opacity-70">
              <summary className="cursor-pointer">Show quoted text</summary>
              <p className="whitespace-pre-wrap break-words mt-1">{quoted}</p>
            </details>
          )}
        </div>
        {media.length > 0 && (
          <div className="space-y-2 w-[min(32rem,80vw)]">
            {media.map((x) => (
              <MediaCard key={x.id} m={x} />
            ))}
          </div>
        )}
        <p className={cn("text-[11px] text-muted-foreground", out && "text-right")}>
          {out ? "You" : "Candidate"} · {new Date(when).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
        </p>
      </div>
    </div>
  )
}

/** The existing create-agent flow (same createAgent action as the Agents page), pre-filled. */
function HireDialog({ recruit, onClose, onHired }: { recruit: Recruit; onClose: () => void; onHired: () => void }) {
  const [busy, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function submit(formData: FormData) {
    setError(null)
    start(async () => {
      const r = await createAgent(formData)
      if (r.error) return setError(r.error)
      const link = await linkHiredRecruit(recruit.id, String(formData.get("email") ?? ""))
      if (link.error) return setError(link.error)
      toast.success("Agent created and recruit marked hired")
      onHired()
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-card border rounded-xl shadow-xl w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="font-semibold text-sm">Add agent</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        <form action={submit} className="px-5 py-4 space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground" htmlFor="hire-name">Name</label>
            <Input id="hire-name" name="name" required defaultValue={recruit.name} className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground" htmlFor="hire-email">Email</label>
            <Input id="hire-email" name="email" type="email" required defaultValue={recruit.email} className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground" htmlFor="hire-password">Password</label>
            <Input id="hire-password" name="password" type="password" minLength={8} required className="h-9 text-sm" />
            <p className="text-[11px] text-muted-foreground">At least 8 characters. Share it with the new agent yourself.</p>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button type="submit" size="sm" disabled={busy}>{busy ? "Creating…" : "Create agent"}</Button>
          </div>
        </form>
      </div>
    </div>
  )
}
