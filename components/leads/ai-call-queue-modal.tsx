"use client"

import { useEffect, useRef, useState } from "react"
import { Bot, CheckCircle2, CircleSlash, Clock, Loader2, PhoneCall, Square, TriangleAlert, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  MAX_QUEUE,
  runAiCallQueue,
  summarise,
  type CallSnapshot,
  type QueueDeps,
  type QueueItem,
  type StartResult,
} from "@/lib/ai-call-queue"

const GAP_MS = 15_000 // breathing room between one call ending and the next starting
const POLL_MS = 4_000
const MAX_WAIT_MS = 8 * 60_000 // a call is capped at 5 minutes; this allows for the report

export interface QueueLead {
  leadId: string
  label: string
}

async function startCall(leadId: string): Promise<StartResult> {
  const res = await fetch("/api/ai-calls/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ leadId }), // never an hours override: the queue obeys the calling hours
  })
  const json = (await res.json().catch(() => ({}))) as { error?: string; code?: string; eventId?: string }
  if (res.ok && json.eventId) return { ok: true, eventId: json.eventId }
  return { ok: false, error: json.error ?? `Couldn't start the call (${res.status})`, code: json.code, status: res.status }
}

async function getCall(eventId: string): Promise<CallSnapshot | null> {
  const res = await fetch(`/api/ai-calls/status?eventId=${encodeURIComponent(eventId)}`, { cache: "no-store" })
  return res.ok ? ((await res.json()) as CallSnapshot) : null
}

const deps: QueueDeps = {
  startCall,
  getCall,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  gapMs: GAP_MS,
  pollMs: POLL_MS,
  maxWaitMs: MAX_WAIT_MS,
}

const fmt = (s: number | null | undefined) => (s ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : "")

export function AiCallQueueModal({ leads, onClose }: { leads: QueueLead[]; onClose: () => void }) {
  const capped = leads.slice(0, MAX_QUEUE)
  const [phase, setPhase] = useState<"confirm" | "running" | "finished">("confirm")
  const [items, setItems] = useState<QueueItem[]>(() => capped.map((l) => ({ ...l, status: "waiting" as const })))
  const [stopping, setStopping] = useState(false)
  const stopRef = useRef(false)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      stopRef.current = true // closing the page stops the queue; a call already placed carries on
    }
  }, [])

  // Closing the tab mid-queue would silently stop it: ask first.
  useEffect(() => {
    if (phase !== "running") return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ""
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [phase])

  async function start() {
    setPhase("running")
    const final = await runAiCallQueue(
      items,
      deps,
      (next) => aliveRef.current && setItems(next),
      () => stopRef.current,
    )
    if (aliveRef.current) {
      setItems(final)
      setPhase("finished")
    }
  }

  function stop() {
    stopRef.current = true
    setStopping(true)
  }

  const sum = summarise(items)
  const finishedCount = items.filter((i) => i.status !== "waiting" && i.status !== "calling").length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4 animate-in-fade">
      <div role="dialog" aria-modal="true" aria-label="AI auto-dial" className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-xl border bg-card shadow-xl animate-in-rise">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Bot className="size-4" />
            AI auto-dial {phase === "confirm" ? `— ${capped.length} lead${capped.length === 1 ? "" : "s"}` : `— ${finishedCount} of ${items.length}`}
          </h2>
          {phase !== "running" && (
            <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">
              Close
            </button>
          )}
        </div>

        {phase === "running" && (
          <div className="h-1 w-full bg-muted" aria-hidden>
            <div className="h-full bg-blue-600 transition-[width] duration-500 ease-[var(--ease-out)]" style={{ width: `${(finishedCount / items.length) * 100}%` }} />
          </div>
        )}

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {phase === "confirm" && (
            <div className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-900 dark:text-amber-200">
              <p className="flex items-start gap-2">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>
                  The AI will call these leads <b>one at a time</b>, waiting for each call to end and pausing {GAP_MS / 1000}s
                  before the next. Keep this page open: closing it stops the queue.
                </span>
              </p>
              <p className="pl-5">
                Every lead is still checked for consent, do-not-call, calling hours (the queue never overrides them), the
                daily cap and test mode. Leads that don&apos;t pass are skipped with the reason shown. Calls are recorded and
                transcribed; the AI introduces itself as a virtual assistant. Results save to each lead automatically.
              </p>
              {leads.length > MAX_QUEUE && <p className="pl-5 font-medium">Only the first {MAX_QUEUE} of {leads.length} selected leads will be called.</p>}
            </div>
          )}

          <ul className="divide-y rounded-md border">
            {items.map((i) => (
              <li key={i.leadId} className="flex items-start gap-3 px-3 py-2.5 text-sm">
                <StatusIcon status={i.status} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{i.label}</p>
                  {(i.status !== "waiting" || i.detail) && (
                    <p className={`text-xs ${i.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}>
                      {i.detail}
                      {i.durationSeconds ? ` · ${fmt(i.durationSeconds)}` : ""}
                      {i.sentiment ? ` · ${i.sentiment}` : ""}
                    </p>
                  )}
                  {i.summary && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{i.summary}</p>}
                </div>
              </li>
            ))}
          </ul>

          {phase === "finished" && (
            <p className="rounded-md bg-muted/50 px-3 py-2 text-xs">
              Done: <b>{sum.called}</b> called ({sum.answered} connected), <b>{sum.skipped}</b> skipped, <b>{sum.failed}</b> failed
              {sum.stopped ? `, ${sum.stopped} not called` : ""}. Open a lead to see its transcript and summary.
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
          {phase === "confirm" && (
            <>
              <Button variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button size="sm" className="gap-1.5" onClick={start} disabled={capped.length === 0}>
                <PhoneCall className="size-3.5" />
                Start calling {capped.length}
              </Button>
            </>
          )}
          {phase === "running" && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={stop} disabled={stopping}>
              <Square className="size-3.5" />
              {stopping ? "Stopping after this call…" : "Stop after current call"}
            </Button>
          )}
          {phase === "finished" && (
            <Button size="sm" onClick={onClose}>
              Close
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function StatusIcon({ status }: { status: QueueItem["status"] }) {
  const cls = "mt-0.5 size-4 shrink-0"
  switch (status) {
    case "calling":
      return <Loader2 className={`${cls} animate-spin text-blue-600`} aria-label="Calling" />
    case "done":
      return <CheckCircle2 className={`${cls} text-green-600`} aria-label="Done" />
    case "skipped":
      return <CircleSlash className={`${cls} text-amber-600`} aria-label="Skipped" />
    case "failed":
      return <XCircle className={`${cls} text-destructive`} aria-label="Failed" />
    case "stopped":
      return <Square className={`${cls} text-muted-foreground`} aria-label="Not called" />
    default:
      return <Clock className={`${cls} text-muted-foreground/60`} aria-label="Waiting" />
  }
}
