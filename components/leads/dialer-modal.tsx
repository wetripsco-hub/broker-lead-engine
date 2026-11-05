"use client"

import { useState, useEffect, useRef, useCallback, useTransition } from "react"
import {
  Phone,
  PhoneOff,
  Mic,
  MicOff,
  X,
  CheckCircle2,
  Clock,
  Grid3x3,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import {
  logCallStarted,
  saveCallDisposition,
  saveCallTranscript,
} from "@/app/(dashboard)/leads/[id]/call-actions"
import { CopilotPanel } from "@/components/copilot/copilot-panel"
import type { CallWrapUp } from "@/lib/copilot/types"
import { DISPOSITION_LABEL, DISPOSITION_MENU, isSmsPermissionOutcome } from "@/lib/call-dispositions"
import { OUTCOME_NEXT_ACTION } from "@/lib/call-script/script"
import { CallScriptPanel } from "@/components/leads/call-script-panel"
import { formatPhoneDisplay, toE164 } from "@/lib/phone"
import type { DispositionKey } from "@/lib/call-dispositions"

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase =
  | "connecting"   // fetching token + registering WebRTC
  | "dialing"      // registered, INVITE sent, ringing
  | "active"       // call answered
  | "ended"        // call ended, waiting for disposition
  | "saving"       // saving disposition

interface DialerModalProps {
  leadId: string
  agentId: string
  brokerPhone: string
  brokerName: string | null
  /** Copilot preference chosen on the lead page before dialing. */
  copilotOn?: boolean
  /** For the call script panel: the lead's contact name, the caller's name, the admin-set callback number. */
  contactName?: string | null
  agentName?: string | null
  callbackPhone?: string | null
  /** Shown instead of the number (agents see it masked). The real `brokerPhone` is only dialled. */
  displayPhone?: string | null
  /** Agents only: "Calls this hour: 23/40". */
  callsThisHour?: { count: number; limit: number } | null
  onClose: () => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// The SDK emits structured error objects ({ code, name, message, description })
// for things like MEDIA_MICROPHONE_PERMISSION_DENIED — String(e) on those
// gives "[object Object]", so pull the useful field out first.
function telnyxErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === "object") {
    const anyE = e as any
    return anyE.message || anyE.description || anyE.name || JSON.stringify(e)
  }
  return String(e)
}

function formatDuration(s: number) {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, "0")}`
}

function brokerInitial(name: string | null, phone: string): string {
  if (name) return name.trim()[0].toUpperCase()
  return phone[0]
}

const DISPOSITIONS: DispositionKey[] = DISPOSITION_MENU

// In-call keypad (DTMF) — for phone menus like "press 0 for the operator".
const DTMF_KEYS: { key: string; sub?: string }[] = [
  { key: "1" }, { key: "2", sub: "ABC" }, { key: "3", sub: "DEF" },
  { key: "4", sub: "GHI" }, { key: "5", sub: "JKL" }, { key: "6", sub: "MNO" },
  { key: "7", sub: "PQRS" }, { key: "8", sub: "TUV" }, { key: "9", sub: "WXYZ" },
  { key: "*" }, { key: "0", sub: "+" }, { key: "#" },
]

// ─── Phase header config ───────────────────────────────────────────────────────

const PHASE_CONFIG: Record<
  Phase,
  { label: string; color: string; ring: string }
> = {
  connecting: {
    label: "Connecting…",
    color: "text-amber-600 dark:text-amber-400",
    ring: "border-amber-400",
  },
  dialing: {
    label: "Calling",
    color: "text-amber-600 dark:text-amber-400",
    ring: "border-amber-400",
  },
  active: {
    label: "On call",
    color: "text-green-600 dark:text-green-400",
    ring: "border-green-500",
  },
  ended: {
    label: "Call ended",
    color: "text-muted-foreground",
    ring: "border-muted",
  },
  saving: {
    label: "Saving…",
    color: "text-muted-foreground",
    ring: "border-muted",
  },
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DialerModal({
  leadId,
  agentId,
  brokerPhone,
  brokerName,
  copilotOn = false,
  contactName = null,
  agentName = null,
  callbackPhone = null,
  displayPhone,
  callsThisHour = null,
  onClose,
}: DialerModalProps) {
  const [phase, setPhase] = useState<Phase>("connecting")
  const [muted, setMuted] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [disposition, setDisposition] = useState<DispositionKey>("no_answer")
  const [notes, setNotes] = useState("")
  const [isPending, startTransition] = useTransition()
  const [answered, setAnswered] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  // Open by default: phone menus ("press 0 for the operator") are common on these calls.
  const [keypadOpen, setKeypadOpen] = useState(true)
  const [dtmfSent, setDtmfSent] = useState("")

  const clientRef  = useRef<unknown>(null)
  const callRef     = useRef<unknown>(null)
  const eventIdRef  = useRef<string | null>(null)
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef<number>(0)
  const endedRef    = useRef(false) // guard double-fire
  const answeredRef = useRef(false) // read by handlers registered once, on mount
  const audioRef    = useRef<HTMLAudioElement>(null)
  const transcriptRef = useRef("")
  const [wrapUp, setWrapUp] = useState<CallWrapUp | null>(null)
  const [wrapUpLoading, setWrapUpLoading] = useState(false)
  const [followUpDate, setFollowUpDate] = useState("")
  const handleTranscript = useCallback((t: string) => { transcriptRef.current = t }, [])
  const getSources = useCallback(() => {
    const call = callRef.current as any
    return {
      remote: (call?.remoteStream ?? (audioRef.current?.srcObject as MediaStream | null) ?? null) as MediaStream | null,
      local: (call?.localStream ?? null) as MediaStream | null,
    }
  }, [])

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

  // ── Handle call ended ─────────────────────────────────────────────────────

  const handleCallEnd = useCallback(() => {
    if (endedRef.current) return
    endedRef.current = true
    if (timerRef.current) clearInterval(timerRef.current)
    setPhase("ended")
    // Auto-select disposition based on whether call was ever active
    setDisposition(answeredRef.current ? "not_interested" : "no_answer")
  }, [])

  // After the call: persist the transcript right away, then ask for a short
  // summary + suggested disposition (the agent still confirms before saving).
  useEffect(() => {
    if (phase !== "ended") return
    const transcript = transcriptRef.current
    if (!transcript.trim()) return
    if (eventIdRef.current) saveCallTranscript(eventIdRef.current, transcript)
    let cancelled = false
    setWrapUpLoading(true)
    fetch("/api/copilot/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId, transcript }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((w: CallWrapUp | null) => {
        if (cancelled || !w) return
        setWrapUp(w)
        setDisposition(w.disposition)
        setNotes((n) => n || w.summary)
        setFollowUpDate(w.follow_up_date ?? "")
      })
      .catch(() => {})
      .finally(() => !cancelled && setWrapUpLoading(false))
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase === "ended"])

  // ── Start call (on mount) ─────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false

    async function dial() {
      try {
        // 1. Fetch WebRTC token
        const res = await fetch("/api/telnyx/token")
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.error ?? "Token error")
        }
        const { token } = await res.json()
        if (cancelled) return

        // 2. Load SDK
        const { TelnyxRTC } = await import("@telnyx/webrtc")
        if (cancelled) return

        // 3. Register
        const client = new TelnyxRTC({ login_token: token })
        clientRef.current = client
        // Without this the SDK has no element to attach the remote audio
        // stream to, so the browser side never hears the other party.
        if (audioRef.current) (client as any).remoteElement = audioRef.current

        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("Registration timed out (15 s)")),
            15000,
          )
          ;(client as any).on("telnyx.ready", () => { clearTimeout(timeout); resolve() })
          ;(client as any).on("telnyx.error", (e: unknown) => { clearTimeout(timeout); reject(new Error(telnyxErrorMessage(e))) })
          ;(client as any).connect()
        })
        if (cancelled) return

        // Errors after registration (e.g. mic permission denied when the call
        // tries to grab getUserMedia) don't reject the promise above — it's
        // already settled — so without this listener they fail silently.
        ;(client as any).on("telnyx.error", (e: unknown) => {
          if (cancelled) return
          toast.error(`Call error: ${telnyxErrorMessage(e)}`)
          handleCallEnd()
        })

        setPhase("dialing")

        // 4. Log call start
        const { eventId, error: logErr, blocked } = await logCallStarted(leadId, agentId, null)
        if (blocked) {
          // Do-not-call: never place the call.
          toast.error(logErr ?? "This lead is marked do-not-call.")
          endedRef.current = true
          try { (client as any).disconnect?.() } catch { /* ignore */ }
          onClose()
          return
        }
        if (logErr) toast.error(`Log error: ${logErr}`)
        else eventIdRef.current = eventId ?? null
        if (cancelled) return

        // 5. Place call
        const clientState = btoa(JSON.stringify({ leadId, agentId, eventId: eventIdRef.current }))
        const fromNumber = process.env.NEXT_PUBLIC_TELNYX_FROM_NUMBER ?? ""
        const call = (client as any).newCall({
          destinationNumber: toE164(brokerPhone) ?? brokerPhone,
          callerNumber: fromNumber,
          clientState,
        })
        callRef.current = call

        // 6. Listen for state
        ;(client as any).on("telnyx.notification", (n: any) => {
          if (n.type !== "callUpdate" || !n.call) return
          const state: string = n.call.state
          if (state === "active") {
            answeredRef.current = true
            setAnswered(true)
            setPhase("active")
            startTimeRef.current = Date.now()
            // Mobile browsers block autoplay outside a direct user gesture;
            // this nudge runs after the user's own "Call" click, so it's allowed.
            audioRef.current?.play().catch(() => {})
          }
          if (["hangup", "destroy", "purge"].includes(state)) {
            handleCallEnd()
          }
        })
      } catch (err: unknown) {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : String(err)
        toast.error(`Call error: ${msg}`)
        onClose()
      }
    }

    dial()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Controls ──────────────────────────────────────────────────────────────

  const hangUp = useCallback(() => {
    const call = callRef.current as any
    if (call?.hangup) call.hangup()
    else handleCallEnd()
  }, [handleCallEnd])

  const toggleMute = useCallback(() => {
    const call = callRef.current as any
    if (call?.toggleAudioMute) {
      call.toggleAudioMute()
      setMuted((m) => !m)
    }
  }, [])

  const sendDigit = useCallback((digit: string) => {
    if (phase !== "active") return
    const call = callRef.current as { dtmf?: (d: string) => void } | null
    if (!call?.dtmf) return
    try {
      call.dtmf(digit)
      setDtmfSent((s) => (s + digit).slice(-24))
    } catch (e) {
      toast.error(`Keypad error: ${telnyxErrorMessage(e)}`)
    }
  }, [phase])

  // While the keypad is open, the physical keyboard's 0-9 * # also send tones
  // (ignored when typing in a text field, e.g. the copilot or notes).
  useEffect(() => {
    if (!keypadOpen || phase !== "active") return
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (/^[0-9*#]$/.test(e.key)) {
        e.preventDefault()
        sendDigit(e.key)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [keypadOpen, phase, sendDigit])

  function handleSaveDisposition() {
    if (!eventIdRef.current) { onClose(); return }
    startTransition(async () => {
      setPhase("saving")
      const { error } = await saveCallDisposition(
        eventIdRef.current!,
        leadId,
        disposition,
        notes,
        seconds,
        { aiSummary: wrapUp?.summary ?? null, followUpDate: followUpDate || null },
      )
      if (error) {
        toast.error(`Save failed: ${error}`)
        setSaveFailed(true)
        setPhase("ended")
      } else {
        toast.success("Call logged")
        onClose()
      }
    })
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const cfg = PHASE_CONFIG[phase]
  const initial = brokerInitial(brokerName, displayPhone ?? brokerPhone)
  const isPulsing = phase === "dialing"
  const isActive  = phase === "active"
  const isEnded   = phase === "ended" || phase === "saving"
  // An answered call needs an outcome. The way out after a failed save stops the agent getting stuck.
  const canSkip   = phase === "ended" && (!answered || saveFailed)

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-black/50">
      {/* Remote audio playout — required by the Telnyx SDK (client.remoteElement) */}
      <audio ref={audioRef} autoPlay playsInline className="hidden" />

      <div className="mx-auto flex min-h-full w-full max-w-[1340px] flex-col items-center gap-3 p-2 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-4 md:flex-row md:flex-wrap md:content-center md:items-start md:justify-center md:gap-4">
      {/* Phones: call controls stay on screen while the script or copilot below is scrolled. */}
      {!isEnded && (
        <div className="sticky top-0 z-20 flex w-full max-w-sm items-center justify-between gap-3 rounded-xl border bg-card/95 px-3 py-2 shadow-lg backdrop-blur md:hidden">
          <div className="min-w-0">
            <p className={`truncate text-xs font-semibold ${cfg.color}`}>{cfg.label}</p>
            <p className="font-mono text-sm tabular-nums">{formatDuration(seconds)}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleMute}
              disabled={phase !== "active"}
              aria-label={muted ? "Unmute" : "Mute"}
              className={`flex size-11 items-center justify-center rounded-full bg-muted disabled:opacity-40 ${muted ? "ring-2 ring-destructive" : ""}`}
            >
              {muted ? <MicOff className="size-5 text-destructive" /> : <Mic className="size-5" />}
            </button>
            <button
              type="button"
              onClick={() => setKeypadOpen((o) => !o)}
              disabled={phase !== "active"}
              aria-label={keypadOpen ? "Hide keypad" : "Show keypad"}
              aria-pressed={keypadOpen}
              className={`flex size-11 items-center justify-center rounded-full bg-muted disabled:opacity-40 ${keypadOpen ? "ring-2 ring-primary" : ""}`}
            >
              <Grid3x3 className="size-5" />
            </button>
            <button
              type="button"
              onClick={hangUp}
              disabled={phase === "connecting"}
              aria-label="End call"
              className="flex size-11 items-center justify-center rounded-full bg-destructive disabled:opacity-40"
            >
              <PhoneOff className="size-5 text-white" />
            </button>
          </div>
        </div>
      )}
      <div className="bg-card border rounded-2xl shadow-2xl w-full max-w-sm flex flex-col overflow-hidden shrink-0">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-2">
            <Phone className={`size-4 ${cfg.color}`} />
            <span className={`text-sm font-semibold ${cfg.color}`}>{cfg.label}</span>
          </div>
          {canSkip && (
            <button
              onClick={onClose}
              aria-label="Close"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        {/* ── Avatar + name ── */}
        <div className="flex flex-col items-center gap-3 px-6 pb-6 pt-2">
          {/* Pulsing ring */}
          <div className="relative flex items-center justify-center">
            {isPulsing && (
              <>
                <span className={`absolute size-24 rounded-full border-2 ${cfg.ring} animate-ping opacity-30`} />
                <span className={`absolute size-20 rounded-full border-2 ${cfg.ring} animate-pulse opacity-50`} />
              </>
            )}
            {isActive && (
              <span className="absolute size-20 rounded-full bg-green-500/10 animate-pulse" />
            )}
            <div
              className={`size-16 rounded-full flex items-center justify-center text-2xl font-bold select-none
                ${isActive ? "bg-green-500/15 text-green-700 dark:text-green-300" : "bg-muted text-muted-foreground"}`}
            >
              {initial}
            </div>
          </div>

          <div className="text-center">
            <p className="font-semibold text-base leading-tight">
              {brokerName ?? "Unknown broker"}
            </p>
            <p className="text-sm text-muted-foreground font-mono mt-0.5">
              {displayPhone !== undefined ? displayPhone : formatPhoneDisplay(brokerPhone)}
            </p>
            {callsThisHour && (
              <p className="text-xs text-muted-foreground mt-1 tabular-nums">
                Calls this hour: {callsThisHour.count}/{callsThisHour.limit}
              </p>
            )}
          </div>

          {/* ── Timer or status label ── */}
          {isActive && (
            <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
              <Clock className="size-3.5" />
              <span className="text-lg font-mono tabular-nums font-semibold">
                {formatDuration(seconds)}
              </span>
            </div>
          )}
          {phase === "connecting" && (
            <p className="text-xs text-muted-foreground animate-pulse">
              Initializing microphone…
            </p>
          )}
          {phase === "dialing" && (
            <p className="text-xs text-muted-foreground">Ringing…</p>
          )}
          {isEnded && seconds > 0 && (
            <div className="flex items-center gap-1.5 text-muted-foreground text-sm">
              <Clock className="size-3.5" />
              <span className="font-mono tabular-nums">{formatDuration(seconds)}</span>
            </div>
          )}
        </div>

        {/* ── In-call keypad (DTMF) ── */}
        {isActive && keypadOpen && (
          <div className="px-6 pb-5">
            <div
              className="mb-2 h-7 truncate rounded-md bg-muted/40 px-3 text-center font-mono text-base leading-7 tracking-widest tabular-nums"
              aria-live="polite"
              aria-label="Keys sent"
            >
              {dtmfSent || <span className="text-xs tracking-normal text-muted-foreground">Press a key to send a tone</span>}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {DTMF_KEYS.map(({ key, sub }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => sendDigit(key)}
                  aria-label={`Send ${key}`}
                  className="flex h-12 flex-col items-center justify-center rounded-lg bg-muted/60 transition-[transform,background-color] duration-100 ease-[var(--ease-out)] hover:bg-muted active:scale-95 active:bg-muted"
                >
                  <span className="text-lg font-semibold leading-none">{key}</span>
                  {sub && <span className="mt-0.5 text-[9px] font-medium tracking-wider text-muted-foreground">{sub}</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Call controls (connecting / dialing / active) ── */}
        {!isEnded && (
          <div className="hidden items-center justify-center gap-6 px-6 pb-7 md:flex">
            {/* Mute */}
            <div className="flex flex-col items-center gap-1.5">
              <button
                onClick={toggleMute}
                disabled={phase !== "active"}
                className={`size-14 rounded-full flex items-center justify-center transition-colors
                  ${phase === "active" ? "bg-muted hover:bg-muted/80 cursor-pointer" : "bg-muted/40 cursor-not-allowed"}
                  ${muted ? "ring-2 ring-destructive" : ""}`}
              >
                {muted
                  ? <MicOff className="size-5 text-destructive" />
                  : <Mic className={`size-5 ${phase === "active" ? "text-foreground" : "text-muted-foreground"}`} />
                }
              </button>
              <span className="text-xs text-muted-foreground">{muted ? "Unmute" : "Mute"}</span>
            </div>

            {/* Keypad */}
            <div className="flex flex-col items-center gap-1.5">
              <button
                onClick={() => setKeypadOpen((o) => !o)}
                disabled={phase !== "active"}
                aria-pressed={keypadOpen}
                className={`size-14 rounded-full flex items-center justify-center transition-colors
                  ${phase === "active" ? "bg-muted hover:bg-muted/80 cursor-pointer" : "bg-muted/40 cursor-not-allowed"}
                  ${keypadOpen ? "ring-2 ring-primary" : ""}`}
              >
                <Grid3x3 className={`size-5 ${phase === "active" ? "text-foreground" : "text-muted-foreground"}`} />
              </button>
              <span className="text-xs text-muted-foreground">{keypadOpen ? "Hide keypad" : "Keypad"}</span>
            </div>

            {/* End call */}
            <div className="flex flex-col items-center gap-1.5">
              <button
                onClick={hangUp}
                disabled={phase === "connecting"}
                className="size-14 rounded-full bg-destructive hover:bg-destructive/90 flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <PhoneOff className="size-5 text-white" />
              </button>
              <span className="text-xs text-muted-foreground">End call</span>
            </div>
          </div>
        )}

        {/* ── Disposition form (after call ends) ── */}
        {isEnded && (
          <div className="border-t px-5 py-5 space-y-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Call outcome
            </p>

            {(wrapUpLoading || wrapUp) && (
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
                <p className="font-medium text-muted-foreground">AI summary — review before saving</p>
                <p className="mt-1">{wrapUpLoading ? "Summarising…" : wrapUp?.summary}</p>
              </div>
            )}

            {/* Disposition select */}
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground" htmlFor="disposition-select">
                Disposition
              </label>
              <select
                id="disposition-select"
                value={disposition}
                onChange={(e) => setDisposition(e.target.value as DispositionKey)}
                disabled={phase === "saving"}
                className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              >
                {DISPOSITIONS.map((d) => (
                  <option key={d} value={d}>{DISPOSITION_LABEL[d]}</option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Next: {OUTCOME_NEXT_ACTION[disposition] ?? "—"}
              </p>
              {isSmsPermissionOutcome(disposition) && (
                <p className="text-xs text-blue-700 dark:text-blue-400">
                  Saving this records that they gave permission to be texted, with today&apos;s date.
                </p>
              )}
              {disposition === "do_not_call" && (
                <p className="text-xs font-medium text-destructive">
                  Saving this stops all calls and texts to this lead and adds the number to the do-not-call list.
                </p>
              )}
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground" htmlFor="call-notes">
                Notes <span className="text-muted-foreground/60">(optional)</span>
              </label>
              <textarea
                id="call-notes"
                value={notes}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNotes(e.target.value)}
                placeholder="What was discussed? Any follow-up needed?"
                rows={3}
                disabled={phase === "saving"}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm resize-none outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground/60 disabled:opacity-50"
              />
            </div>

            {wrapUp && (
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground" htmlFor="follow-up-date">
                  Follow-up date <span className="text-muted-foreground/60">(optional)</span>
                </label>
                <input
                  id="follow-up-date"
                  type="date"
                  value={followUpDate}
                  onChange={(e) => setFollowUpDate(e.target.value)}
                  disabled={phase === "saving"}
                  className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                />
              </div>
            )}

            {/* Save */}
            <Button
              className="w-full gap-2"
              onClick={handleSaveDisposition}
              disabled={isPending || phase === "saving"}
            >
              <CheckCircle2 className="size-4" />
              {phase === "saving" ? "Saving…" : "Save & close"}
            </Button>
            {canSkip && (
              <Button variant="ghost" className="w-full" onClick={onClose} disabled={isPending}>
                Skip
              </Button>
            )}
          </div>
        )}
      </div>

      <CopilotPanel
        leadId={leadId}
        initialOn={copilotOn}
        callId={eventIdRef.current}
        callLive={phase === "dialing" || phase === "active"}
        getSources={getSources}
        onTranscript={handleTranscript}
      />
      <CallScriptPanel variant="dialer" contactName={contactName} agentName={agentName} callbackPhone={callbackPhone} />
      </div>
    </div>
  )
}
