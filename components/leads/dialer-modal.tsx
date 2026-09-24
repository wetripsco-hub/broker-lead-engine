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
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import {
  logCallStarted,
  saveCallDisposition,
} from "@/app/(dashboard)/leads/[id]/call-actions"
import { DISPOSITION_LABEL } from "@/lib/call-dispositions"
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

const DISPOSITIONS: DispositionKey[] = [
  "no_answer",
  "left_voicemail",
  "answered_interested",
  "answered_not_interested",
  "callback",
  "wrong_number",
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
  onClose,
}: DialerModalProps) {
  const [phase, setPhase] = useState<Phase>("connecting")
  const [muted, setMuted] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [disposition, setDisposition] = useState<DispositionKey>("no_answer")
  const [notes, setNotes] = useState("")
  const [isPending, startTransition] = useTransition()

  const clientRef   = useRef<unknown>(null)
  const callRef     = useRef<unknown>(null)
  const eventIdRef  = useRef<string | null>(null)
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef<number>(0)
  const endedRef    = useRef(false) // guard double-fire
  const audioRef    = useRef<HTMLAudioElement>(null)

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
    setDisposition(seconds > 0 ? "answered_not_interested" : "no_answer")
  }, [seconds])

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
        const { eventId, error: logErr } = await logCallStarted(leadId, agentId, null)
        if (logErr) toast.error(`Log error: ${logErr}`)
        else eventIdRef.current = eventId ?? null
        if (cancelled) return

        // 5. Place call
        const clientState = btoa(JSON.stringify({ leadId, agentId }))
        const fromNumber = process.env.NEXT_PUBLIC_TELNYX_FROM_NUMBER ?? ""
        const call = (client as any).newCall({
          destinationNumber: brokerPhone,
          callerNumber: fromNumber,
          clientState,
        })
        callRef.current = call

        // 6. Listen for state
        ;(client as any).on("telnyx.notification", (n: any) => {
          if (n.type !== "callUpdate" || !n.call) return
          const state: string = n.call.state
          if (state === "active") {
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
      )
      if (error) {
        toast.error(`Save failed: ${error}`)
        setPhase("ended")
      } else {
        toast.success("Call logged")
        onClose()
      }
    })
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const cfg = PHASE_CONFIG[phase]
  const initial = brokerInitial(brokerName, brokerPhone)
  const isPulsing = phase === "dialing"
  const isActive  = phase === "active"
  const isEnded   = phase === "ended" || phase === "saving"

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      {/* Remote audio playout — required by the Telnyx SDK (client.remoteElement) */}
      <audio ref={audioRef} autoPlay playsInline className="hidden" />

      <div className="bg-card border rounded-2xl shadow-2xl w-full max-w-sm flex flex-col overflow-hidden">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-2">
            <Phone className={`size-4 ${cfg.color}`} />
            <span className={`text-sm font-semibold ${cfg.color}`}>{cfg.label}</span>
          </div>
          {isEnded && (
            <button
              onClick={onClose}
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
            <p className="text-sm text-muted-foreground font-mono mt-0.5">{brokerPhone}</p>
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

        {/* ── Call controls (connecting / dialing / active) ── */}
        {!isEnded && (
          <div className="flex items-center justify-center gap-6 px-6 pb-7">
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

            {/* Save */}
            <Button
              className="w-full gap-2"
              onClick={handleSaveDisposition}
              disabled={isPending || phase === "saving"}
            >
              <CheckCircle2 className="size-4" />
              {phase === "saving" ? "Saving…" : "Save & close"}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
