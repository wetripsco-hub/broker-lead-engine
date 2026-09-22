"use client"

import { useState, useEffect, useRef, useCallback, useTransition } from "react"
import {
  Phone,
  PhoneOff,
  Mic,
  MicOff,
  Delete,
  Clock,
  CheckCircle2,
  X,
  History,
  Grid3x3,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import {
  logDirectCallStarted,
  saveDirectCallEnd,
  getDirectCallHistory,
  type DirectCallHistoryItem,
  type HistoryFilter,
} from "@/app/(dashboard)/dialer-actions"

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase = "idle" | "connecting" | "dialing" | "active" | "ended" | "saving"
type Tab = "dialer" | "history"

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"]

function formatDuration(s: number) {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, "0")}`
}

function parseDuration(body: string | null): number | null {
  if (!body) return null
  const m = body.match(/Duration:\s*(\d+)s/)
  return m ? parseInt(m[1], 10) : null
}

function parseNotes(body: string | null): string | null {
  if (!body) return null
  const m = body.match(/Notes:\s*([\s\S]*)/)
  return m ? m[1].trim() : null
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DialerWidget({ agentId }: { agentId: string | null }) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>("dialer")
  const [indicator, setIndicator] = useState({ left: 0, width: 0 })
  const dialerTabRef = useRef<HTMLButtonElement>(null)
  const historyTabRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const el = tab === "dialer" ? dialerTabRef.current : historyTabRef.current
    if (el) setIndicator({ left: el.offsetLeft, width: el.offsetWidth })
  }, [tab, open])

  // Call state (lives here, not in the panel, so a call survives the panel closing)
  const [phase, setPhase] = useState<Phase>("idle")
  const [number, setNumber] = useState("")
  const [muted, setMuted] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [notes, setNotes] = useState("")
  const [isPending, startTransition] = useTransition()

  // History state
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("today")
  const [historyItems, setHistoryItems] = useState<DirectCallHistoryItem[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const clientRef    = useRef<unknown>(null)
  const callRef      = useRef<unknown>(null)
  const eventIdRef   = useRef<string | null>(null)
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef<number>(0)
  const endedRef     = useRef(false)
  const numberRef    = useRef("")

  const isBusy = phase !== "idle" // used for the trigger indicator dot

  // ── Timer ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (phase === "active") {
      startTimeRef.current = Date.now()
      timerRef.current = setInterval(
        () => setSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000)),
        500,
      )
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [phase])

  // ── Load history when tab opens / filter changes ────────────────────────────

  const loadHistory = useCallback((filter: HistoryFilter) => {
    setHistoryLoading(true)
    startTransition(async () => {
      const { events, error } = await getDirectCallHistory(filter)
      if (error) toast.error(`History error: ${error}`)
      setHistoryItems(events ?? [])
      setHistoryLoading(false)
    })
  }, [])

  useEffect(() => {
    if (open && tab === "history") loadHistory(historyFilter)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab, historyFilter])

  // ── Call ended handler ───────────────────────────────────────────────────

  const handleCallEnd = useCallback(() => {
    if (endedRef.current) return
    endedRef.current = true
    if (timerRef.current) clearInterval(timerRef.current)
    setPhase("ended")
  }, [])

  // ── Keypad ────────────────────────────────────────────────────────────────

  function pressKey(digit: string) {
    if (phase === "active") {
      const call = callRef.current as { dtmf?: (d: string) => void } | null
      call?.dtmf?.(digit)
      return
    }
    if (phase !== "idle") return
    setNumber((n) => (n + digit).slice(0, 20))
  }

  function backspace() {
    if (phase !== "idle") return
    setNumber((n) => n.slice(0, -1))
  }

  // ── Start call ────────────────────────────────────────────────────────────

  async function startCall() {
    if (!agentId) {
      toast.error("No agent record linked to your account")
      return
    }
    const dialed = number.trim()
    if (dialed.length < 7) {
      toast.error("Enter a valid phone number")
      return
    }
    numberRef.current = dialed
    endedRef.current = false
    setPhase("connecting")

    try {
      const res = await fetch("/api/telnyx/token")
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? "Token error")
      }
      const { token } = await res.json()

      const { TelnyxRTC } = await import("@telnyx/webrtc")
      const client = new TelnyxRTC({ login_token: token })
      clientRef.current = client

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Registration timed out (15 s)")), 15000)
        ;(client as any).on("telnyx.ready", () => { clearTimeout(timeout); resolve() })
        ;(client as any).on("telnyx.error", (e: unknown) => { clearTimeout(timeout); reject(new Error(String(e))) })
        ;(client as any).connect()
      })

      setPhase("dialing")

      const { eventId, error: logErr } = await logDirectCallStarted(agentId, dialed, null)
      if (logErr) toast.error(`Log error: ${logErr}`)
      else eventIdRef.current = eventId ?? null

      const clientState = btoa(JSON.stringify({ agentId, directNumber: dialed }))
      const fromNumber = process.env.NEXT_PUBLIC_TELNYX_FROM_NUMBER ?? ""
      const call = (client as any).newCall({
        destinationNumber: dialed,
        callerNumber: fromNumber,
        clientState,
      })
      callRef.current = call

      ;(client as any).on("telnyx.notification", (n: any) => {
        if (n.type !== "callUpdate" || !n.call) return
        const state: string = n.call.state
        if (state === "active") {
          setPhase("active")
          startTimeRef.current = Date.now()
        }
        if (["hangup", "destroy", "purge"].includes(state)) {
          handleCallEnd()
        }
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`Call failed: ${msg}`)
      setPhase("idle")
    }
  }

  const hangUp = useCallback(() => {
    const call = callRef.current as { hangup?: () => void } | null
    if (call?.hangup) call.hangup()
    else handleCallEnd()
  }, [handleCallEnd])

  const toggleMute = useCallback(() => {
    const call = callRef.current as { toggleAudioMute?: () => void } | null
    if (call?.toggleAudioMute) {
      call.toggleAudioMute()
      setMuted((m) => !m)
    }
  }, [])

  function saveAndReset() {
    if (!eventIdRef.current) {
      resetAll()
      return
    }
    startTransition(async () => {
      setPhase("saving")
      const status = seconds > 0 ? "answered" : "no_answer"
      const { error } = await saveDirectCallEnd(eventIdRef.current!, status, notes, seconds)
      if (error) {
        toast.error(`Save failed: ${error}`)
        setPhase("ended")
      } else {
        toast.success("Call logged")
        resetAll()
        if (tab === "history") loadHistory(historyFilter)
      }
    })
  }

  function resetAll() {
    setPhase("idle")
    setNumber("")
    setNotes("")
    setSeconds(0)
    setMuted(false)
    clientRef.current = null
    callRef.current = null
    eventIdRef.current = null
    numberRef.current = ""
  }

  function togglePanel() {
    setOpen((o) => !o)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const isIdle = phase === "idle"
  const isCalling = phase === "connecting" || phase === "dialing" || phase === "active"
  const isEnded = phase === "ended" || phase === "saving"

  return (
    <div className="relative">
      {/* ── Trigger button ── */}
      <button
        onClick={togglePanel}
        className="group-data-[collapsible=icon]:justify-center flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] hover:text-foreground hover:bg-accent active:scale-[0.98] relative"
      >
        <span className="relative shrink-0">
          <Phone className="size-4" />
          {isBusy && (
            <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-green-500 animate-pulse" />
          )}
        </span>
        <span className="group-data-[collapsible=icon]:hidden">Dialer</span>
        {isBusy && (
          <span className="group-data-[collapsible=icon]:hidden ml-auto text-xs font-mono tabular-nums text-green-600 dark:text-green-400">
            {phase === "active" ? formatDuration(seconds) : "…"}
          </span>
        )}
      </button>

      {/* ── Floating panel ── */}
      {open && (
        <div className="animate-panel-in absolute bottom-full left-0 mb-2 z-50 w-80 bg-card border rounded-xl shadow-2xl flex flex-col overflow-hidden">
          {/* Header with tabs */}
          <div className="relative flex items-center justify-between border-b px-2 pt-2">
            <div className="relative flex gap-1">
              {/* Sliding indicator */}
              <span
                className="absolute bottom-0 h-0.5 bg-foreground transition-[left,width] duration-200 ease-[var(--ease-out)]"
                style={{ left: indicator.left, width: indicator.width }}
              />
              <button
                ref={dialerTabRef}
                onClick={() => setTab("dialer")}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-t-md transition-colors duration-150 ease-[var(--ease-out)] ${
                  tab === "dialer" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Grid3x3 className="size-3.5" />
                Dialer
              </button>
              <button
                ref={historyTabRef}
                onClick={() => setTab("history")}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-t-md transition-colors duration-150 ease-[var(--ease-out)] ${
                  tab === "history" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <History className="size-3.5" />
                History
              </button>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-muted-foreground hover:text-foreground transition-[color,transform] duration-150 ease-[var(--ease-out)] active:scale-90 p-1.5"
            >
              <X className="size-3.5" />
            </button>
          </div>

          {/* ── Dialer tab ── */}
          {tab === "dialer" && (
            <div key="dialer" className="p-3.5 space-y-3 animate-in-rise" style={{ animationDuration: "160ms" }}>
              {isIdle && (
                <>
                  <div className="flex items-center gap-1">
                    <input
                      value={number}
                      onChange={(e) => setNumber(e.target.value.replace(/[^\d*#+]/g, "").slice(0, 20))}
                      placeholder="+1 555 123 4567"
                      className="flex-1 h-9 rounded-md border border-input bg-transparent px-2.5 text-sm font-mono outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground/60 min-w-0"
                    />
                    <button
                      onClick={backspace}
                      disabled={!number}
                      className="size-9 shrink-0 rounded-md transition-[transform,background-color] duration-100 ease-[var(--ease-out)] hover:bg-muted active:scale-90 disabled:opacity-30 flex items-center justify-center"
                    >
                      <Delete className="size-4 text-muted-foreground" />
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {KEYS.map((k) => (
                      <button
                        key={k}
                        onClick={() => pressKey(k)}
                        className="h-10 rounded-md bg-muted/60 text-sm font-medium transition-[transform,background-color] duration-100 ease-[var(--ease-out)] hover:bg-muted active:scale-90 active:bg-muted"
                      >
                        {k}
                      </button>
                    ))}
                  </div>

                  <Button
                    className="w-full gap-1.5"
                    onClick={startCall}
                    disabled={number.trim().length < 7 || !agentId}
                  >
                    <Phone className="size-3.5" />
                    Call
                  </Button>
                  {!agentId && (
                    <p className="text-[11px] text-muted-foreground">No agent record — contact admin</p>
                  )}
                </>
              )}

              {isCalling && (
                <div className="space-y-3">
                  <div className="text-center py-1">
                    <p className="text-sm font-mono font-medium truncate">{numberRef.current}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {phase === "connecting" && "Connecting…"}
                      {phase === "dialing" && "Ringing…"}
                      {phase === "active" && (
                        <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400 font-mono tabular-nums font-semibold text-sm">
                          <Clock className="size-3" />
                          {formatDuration(seconds)}
                        </span>
                      )}
                    </p>
                  </div>

                  {phase === "active" && (
                    <div className="grid grid-cols-3 gap-2">
                      {KEYS.map((k) => (
                        <button
                          key={k}
                          onClick={() => pressKey(k)}
                          className="h-8 rounded-md bg-muted/60 text-xs font-medium transition-[transform,background-color] duration-100 ease-[var(--ease-out)] hover:bg-muted active:scale-90 active:bg-muted"
                        >
                          {k}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 gap-1.5"
                      onClick={toggleMute}
                      disabled={phase !== "active"}
                    >
                      {muted ? <MicOff className="size-3.5 text-destructive" /> : <Mic className="size-3.5" />}
                      {muted ? "Unmute" : "Mute"}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="flex-1 gap-1.5"
                      onClick={hangUp}
                      disabled={phase === "connecting"}
                    >
                      <PhoneOff className="size-3.5" />
                      End
                    </Button>
                  </div>
                </div>
              )}

              {isEnded && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Call ended{seconds > 0 ? ` · ${formatDuration(seconds)}` : ""} · {numberRef.current}
                  </p>
                  <textarea
                    value={notes}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNotes(e.target.value)}
                    placeholder="Notes (optional)…"
                    rows={2}
                    disabled={phase === "saving"}
                    className="w-full rounded-md border border-input bg-transparent px-2.5 py-2 text-xs resize-none outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground/60 disabled:opacity-50"
                  />
                  <Button
                    size="sm"
                    className="w-full gap-1.5"
                    onClick={saveAndReset}
                    disabled={isPending || phase === "saving"}
                  >
                    <CheckCircle2 className="size-3.5" />
                    {phase === "saving" ? "Saving…" : "Save & close"}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* ── History tab ── */}
          {tab === "history" && (
            <div key="history" className="flex flex-col max-h-96 animate-in-rise" style={{ animationDuration: "160ms" }}>
              <div className="flex items-center gap-1 px-3 pt-2.5 pb-1">
                {(["today", "week", "all"] as HistoryFilter[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => setHistoryFilter(f)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-95 ${
                      historyFilter === f
                        ? "bg-foreground text-background"
                        : "bg-muted/60 text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {f === "today" ? "Today" : f === "week" ? "This week" : "All time"}
                  </button>
                ))}
              </div>

              <div className="flex-1 overflow-y-auto px-1 pb-2">
                {historyLoading ? (
                  <div className="space-y-2 px-2 py-2">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="h-12 rounded-md bg-muted/60 animate-skeleton" />
                    ))}
                  </div>
                ) : historyItems.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-6 animate-in-fade">No direct calls yet.</p>
                ) : (
                  <ul className="divide-y">
                    {historyItems.map((ev, i) => {
                      const duration = parseDuration(ev.message_body)
                      const noteText = parseNotes(ev.message_body)
                      const answered = ev.status === "answered"
                      return (
                        <li
                          key={ev.id}
                          className="px-2.5 py-2.5 rounded-md transition-colors duration-150 ease-[var(--ease-out)] hover:bg-muted/40 animate-in-fade"
                          style={{ animationDelay: `${Math.min(i * 30, 240)}ms` }}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-mono font-medium truncate">{ev.direct_number}</span>
                            <span
                              className={`text-xs shrink-0 ${
                                answered
                                  ? "text-green-600 dark:text-green-400"
                                  : "text-yellow-600 dark:text-yellow-400"
                              }`}
                            >
                              {answered ? "Answered" : "No answer"}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                            {duration != null && <span>{formatDuration(duration)}</span>}
                            <span>·</span>
                            <span>
                              {new Date(ev.occurred_at).toLocaleString(undefined, {
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>
                          {noteText && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{noteText}</p>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
