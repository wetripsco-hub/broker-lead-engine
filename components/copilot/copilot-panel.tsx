"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Check, Copy, MessageSquareQuote, TriangleAlert } from "lucide-react"
import { useTranscription, type MediaSources } from "./use-transcription"
import {
  RECORDING_REMINDER,
  type CopilotContext,
  type Suggestion,
} from "@/lib/copilot/types"

interface CopilotPanelProps {
  leadId: string
  callId: string | null
  /** Dialing or on a live call: the only time transcription may run. */
  callLive: boolean
  getSources: () => MediaSources
  /** Latest full transcript ("Broker: …\nAgent: …"), for saving after the call. */
  onTranscript: (text: string) => void
}

const SILENCE_MS = 1000
const MIN_GAP_MS = 3000
const RETRY_MS = 2000

type SuggestState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "busy" }
  | { kind: "unavailable" }

export function CopilotPanel({ leadId, callId, callLive, getSources, onTranscript }: CopilotPanelProps) {
  const [ctx, setCtx] = useState<CopilotContext | null>(null)
  const [on, setOn] = useState(false) // always starts off; the agent opts in
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null)
  const [stale, setStale] = useState(false)
  const [sState, setSState] = useState<SuggestState>({ kind: "idle" })

  // ── Lead card, opening script, consent flag (our own DB only) ──
  useEffect(() => {
    let cancelled = false
    fetch(`/api/copilot/context?leadId=${encodeURIComponent(leadId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => !cancelled && setCtx(c))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [leadId])

  // ── Suggestions ──
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlightRef = useRef(false)
  const lastRequestRef = useRef(0)
  const getTurnsRef = useRef<() => { speaker: "broker" | "agent"; text: string }[]>(() => [])
  const onRef = useRef(on)
  onRef.current = on

  const requestSuggestion = useCallback(
    async (isRetry = false) => {
      if (!onRef.current || inFlightRef.current) return
      const turns = getTurnsRef.current()
      if (turns.length === 0 || turns[turns.length - 1].speaker !== "broker") return
      if (!isRetry && Date.now() - lastRequestRef.current < MIN_GAP_MS) return

      inFlightRef.current = true
      lastRequestRef.current = Date.now()
      setStale(true)
      setSState({ kind: "loading" })
      try {
        const res = await fetch("/api/copilot/suggest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadId, callId, turns }),
        })
        if (res.status === 429) {
          setSState({ kind: "busy" })
          inFlightRef.current = false
          if (!isRetry) setTimeout(() => requestSuggestion(true), RETRY_MS)
          return
        }
        if (!res.ok) throw new Error("suggest failed")
        setSuggestion((await res.json()) as Suggestion)
        setStale(false)
        setSState({ kind: "idle" })
      } catch {
        setSState({ kind: "unavailable" })
      } finally {
        inFlightRef.current = false
      }
    },
    [leadId, callId],
  )

  const onBrokerActivity = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])
  const onBrokerUtterance = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    // Broker finished a sentence: wait for 1 s of silence before asking.
    timerRef.current = setTimeout(() => requestSuggestion(), SILENCE_MS)
  }, [requestSuggestion])

  const { bubbles, status, getTurns } = useTranscription({
    enabled: on && callLive,
    getSources,
    onBrokerActivity,
    onBrokerUtterance,
  })
  getTurnsRef.current = getTurns

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  // Hand the transcript up so it can be saved when the call ends.
  useEffect(() => {
    const text = bubbles
      .filter((b) => b.text.trim())
      .map((b) => `${b.speaker === "broker" ? "Broker" : "Agent"}: ${b.text.trim()}`)
      .join("\n")
    onTranscript(text)
  }, [bubbles, onTranscript])

  // Auto-scroll subtitles.
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
  }, [bubbles])

  function toggle() {
    setOn((v) => {
      if (v && timerRef.current) clearTimeout(timerRef.current)
      return !v
    })
  }

  return (
    <aside
      aria-label="Sales Copilot"
      className="flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl md:w-[380px]"
    >
      {/* Header + toggle */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold">Sales Copilot</h2>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          {on ? "On" : "Off"}
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label="Copilot on/off"
            onClick={toggle}
            className={`relative h-5 w-9 rounded-full transition-colors duration-200 ease-[var(--ease-out)] active:scale-[0.97] ${
              on ? "bg-blue-600" : "bg-muted-foreground/30"
            }`}
          >
            <span
              className={`absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow transition-transform duration-200 ease-[var(--ease-out)] ${
                on ? "translate-x-4" : ""
              }`}
            />
          </button>
        </label>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        {/* Lead card */}
        {ctx && (
          <div className="rounded-lg bg-muted/50 px-3 py-2">
            <p className="truncate text-sm font-medium">{ctx.lead.contactName ?? ctx.lead.companyName}</p>
            <p className="truncate text-xs text-muted-foreground">
              {ctx.lead.contactName ? `${ctx.lead.companyName} · ` : ""}
              {ctx.lead.state ?? "—"}
              {ctx.lead.mcNumber ? ` · MC-${ctx.lead.mcNumber}` : ""}
              {ctx.lead.mcStatus ? ` · ${ctx.lead.mcStatus}` : ""}
            </p>
          </div>
        )}

        {ctx?.announceRecording && (
          <p className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              Say at the start: <em>&ldquo;{RECORDING_REMINDER}&rdquo;</em>
            </span>
          </p>
        )}

        {!on ? (
          <>
            {ctx && <ReplyCard label="Opening" text={ctx.openingScript} />}
            <p className="text-xs text-muted-foreground">
              Copilot is off. Turn it on to transcribe this call and get suggested replies. Nothing is sent to
              any service while it is off.
            </p>
          </>
        ) : (
          <>
            <StatusLine status={status} callLive={callLive} />

            {/* Suggestions */}
            <div
              className={`space-y-2 transition-opacity duration-200 ease-[var(--ease-out)] ${
                stale ? "opacity-50" : "opacity-100"
              }`}
              aria-busy={sState.kind === "loading"}
            >
              {ctx && <ReplyCard label="Opening" text={ctx.openingScript} />}
              {suggestion && (
                <>
                  <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs text-muted-foreground">
                    <MessageSquareQuote className="size-3.5" aria-hidden />
                    <span className="font-medium text-foreground">{suggestion.intent}</span>
                    {suggestion.summary && <span>· {suggestion.summary}</span>}
                    {suggestion.not_in_manual && (
                      <span className="rounded-full bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                        Not in manual
                      </span>
                    )}
                  </div>
                  {suggestion.replies.map((r, i) => (
                    <ReplyCard key={`${r}-${i}`} label={`Reply ${i + 1}`} text={r} />
                  ))}
                  {suggestion.next_question && <ReplyCard label="Ask next" text={suggestion.next_question} />}
                </>
              )}
            </div>
            {sState.kind === "busy" && <Notice>Suggestions busy</Notice>}
            {sState.kind === "unavailable" && <Notice tone="error">Copilot unavailable</Notice>}

            {/* Subtitles */}
            <div className="flex min-h-0 flex-1 flex-col">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Live transcript</p>
              <div
                ref={scrollRef}
                className="max-h-56 min-h-24 space-y-1.5 overflow-y-auto rounded-lg border bg-muted/20 p-2.5"
                aria-live="polite"
              >
                {bubbles.filter((b) => b.text || b.interim).length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {callLive ? "Listening…" : "Transcript appears once the call connects."}
                  </p>
                ) : (
                  bubbles
                    .filter((b) => b.text || b.interim)
                    .map((b) => (
                      <div key={b.id} className={`flex ${b.speaker === "agent" ? "justify-end" : "justify-start"}`}>
                        <p
                          className={`max-w-[85%] rounded-xl px-2.5 py-1.5 text-xs leading-snug ${
                            b.speaker === "agent"
                              ? "bg-blue-600 text-white"
                              : "bg-muted text-foreground"
                          }`}
                        >
                          {b.text}
                          {b.interim && (
                            <span className={`italic ${b.speaker === "agent" ? "text-white/60" : "text-muted-foreground"}`}>
                              {b.text ? " " : ""}
                              {b.interim}
                            </span>
                          )}
                        </p>
                      </div>
                    ))
                )}
              </div>
            </div>
            <p className="text-[11px] leading-snug text-muted-foreground">
              Call audio is sent to Deepgram for transcription, and the transcript to{" "}
              {ctx?.llmProvider === "anthropic" ? "Anthropic" : "Google Gemini"} for suggestions.
            </p>
          </>
        )}
      </div>
    </aside>
  )
}

function StatusLine({ status, callLive }: { status: ReturnType<typeof useTranscription>["status"]; callLive: boolean }) {
  if (!callLive) return null
  if (status === "reconnecting" || status === "unavailable") {
    return (
      <Notice tone="error">
        Transcription disconnected{status === "reconnecting" ? " — reconnecting…" : ""}
      </Notice>
    )
  }
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span
        className={`size-1.5 rounded-full ${status === "live" ? "bg-green-500" : "animate-pulse bg-amber-500"}`}
        aria-hidden
      />
      {status === "live" ? "Live" : "Connecting…"}
    </p>
  )
}

function Notice({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "error" }) {
  return (
    <p
      role="status"
      className={`rounded-md px-3 py-2 text-xs ${
        tone === "error" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"
      }`}
    >
      {children}
    </p>
  )
}

function ReplyCard({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      /* clipboard blocked: nothing to do */
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="group w-full rounded-lg border bg-background px-3 py-2 text-left transition-[background-color,border-color,transform] duration-150 ease-[var(--ease-out)] hover:border-foreground/20 hover:bg-muted/40 active:scale-[0.98]"
    >
      <span className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
        {copied ? (
          <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
            <Check className="size-3" /> Copied
          </span>
        ) : (
          <Copy className="size-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100" aria-hidden />
        )}
      </span>
      <span className="mt-0.5 block text-sm leading-snug">{text}</span>
    </button>
  )
}
