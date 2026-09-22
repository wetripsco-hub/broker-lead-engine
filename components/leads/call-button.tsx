"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Phone, PhoneOff, Mic, MicOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { logCallStarted, logCallEnded } from "@/app/(dashboard)/leads/[id]/call-actions"

type CallState =
  | "idle"
  | "registering"
  | "ready"
  | "dialing"
  | "active"
  | "ended"

interface CallButtonProps {
  leadId: string
  agentId: string
  brokerPhone: string | null
  brokerName: string | null
}

export function CallButton({ leadId, agentId, brokerPhone, brokerName }: CallButtonProps) {
  const [callState, setCallState] = useState<CallState>("idle")
  const [muted, setMuted] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const clientRef = useRef<unknown>(null)
  const callRef = useRef<unknown>(null)
  const eventIdRef = useRef<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef<number>(0)

  // Timer tick
  useEffect(() => {
    if (callState === "active") {
      startTimeRef.current = Date.now() - seconds * 1000
      timerRef.current = setInterval(() => {
        setSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000))
      }, 500)
    } else {
      if (timerRef.current) clearInterval(timerRef.current)
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callState])

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${sec.toString().padStart(2, "0")}`
  }

  const handleCallEnd = useCallback(
    async (status: "answered" | "no_answer" | "failed") => {
      setCallState("ended")
      const duration = Math.floor((Date.now() - startTimeRef.current) / 1000)
      if (eventIdRef.current) {
        await logCallEnded(eventIdRef.current, {
          status,
          durationSeconds: status === "answered" ? duration : undefined,
        })
      }
      // Reset after short delay
      setTimeout(() => {
        setCallState("ready")
        setSeconds(0)
        setMuted(false)
        callRef.current = null
        eventIdRef.current = null
      }, 2000)
    },
    [],
  )

  const startCall = useCallback(async () => {
    if (!brokerPhone) return
    setError(null)
    setCallState("registering")

    try {
      // 1. Get WebRTC token from server
      const tokenRes = await fetch("/api/telnyx/token")
      if (!tokenRes.ok) {
        const err = await tokenRes.json()
        throw new Error(err.error ?? "Token fetch failed")
      }
      const { token } = await tokenRes.json()

      // 2. Dynamically import Telnyx WebRTC (browser-only)
      const { TelnyxRTC } = await import("@telnyx/webrtc")

      // 3. Init and connect
      const client = new TelnyxRTC({ login_token: token })
      clientRef.current = client

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Telnyx registration timed out")), 15000)

        ;(client as unknown as { on: (event: string, cb: (...args: unknown[]) => void) => void }).on(
          "telnyx.ready",
          () => {
            clearTimeout(timeout)
            resolve()
          },
        )
        ;(client as unknown as { on: (event: string, cb: (...args: unknown[]) => void) => void }).on(
          "telnyx.error",
          (err: unknown) => {
            clearTimeout(timeout)
            reject(new Error(String(err)))
          },
        )

        ;(client as unknown as { connect: () => void }).connect()
      })

      setCallState("dialing")

      // 4. Log call start to DB
      const { eventId, error: logErr } = await logCallStarted(leadId, agentId, null)
      if (logErr) toast.error(`Log error: ${logErr}`)
      else eventIdRef.current = eventId ?? null

      // 5. Place call — embed leadId + agentId in client_state for webhook
      const clientState = Buffer.from(
        JSON.stringify({ leadId, agentId }),
      ).toString("base64")

      const fromNumber = process.env.NEXT_PUBLIC_TELNYX_FROM_NUMBER ?? ""
      const call = (
        client as unknown as {
          newCall: (opts: Record<string, unknown>) => unknown
        }
      ).newCall({
        destinationNumber: brokerPhone,
        callerNumber: fromNumber,
        clientState,
      })
      callRef.current = call

      // 6. Listen for call state changes
      ;(
        client as unknown as {
          on: (event: string, cb: (notification: unknown) => void) => void
        }
      ).on("telnyx.notification", (notification: unknown) => {
        const n = notification as {
          type: string
          call?: { state: string; toggleAudioMute?: () => void }
        }
        if (n.type !== "callUpdate" || !n.call) return
        const state = n.call.state

        if (state === "active") {
          setCallState("active")
          startTimeRef.current = Date.now()
        }

        if (state === "hangup" || state === "destroy" || state === "purge") {
          const status = callState === "active" || state === "hangup" ? "answered" : "no_answer"
          handleCallEnd(status as "answered" | "no_answer")
        }
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      setCallState("idle")
      toast.error(`Call failed: ${message}`)
    }
  }, [brokerPhone, leadId, agentId, callState, handleCallEnd])

  const hangUp = useCallback(() => {
    const call = callRef.current as { hangup?: () => void } | null
    if (call?.hangup) call.hangup()
    else handleCallEnd("no_answer")
  }, [handleCallEnd])

  const toggleMute = useCallback(() => {
    const call = callRef.current as { toggleAudioMute?: () => void } | null
    if (call?.toggleAudioMute) {
      call.toggleAudioMute()
      setMuted((m) => !m)
    }
  }, [])

  if (!brokerPhone) {
    return (
      <Button variant="outline" size="sm" disabled className="gap-2">
        <Phone className="size-3.5" />
        No phone
      </Button>
    )
  }

  // Active call UI
  if (callState === "active" || callState === "dialing") {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm font-mono tabular-nums text-green-600 dark:text-green-400 min-w-[3.5rem]">
          {callState === "dialing" ? "Dialing…" : formatTime(seconds)}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={toggleMute}
          disabled={callState === "dialing"}
        >
          {muted ? <MicOff className="size-3.5 text-destructive" /> : <Mic className="size-3.5" />}
          {muted ? "Unmute" : "Mute"}
        </Button>
        <Button
          variant="destructive"
          size="sm"
          className="gap-1.5"
          onClick={hangUp}
        >
          <PhoneOff className="size-3.5" />
          Hang up
        </Button>
      </div>
    )
  }

  if (callState === "ended") {
    return (
      <Button variant="outline" size="sm" disabled className="gap-2 text-muted-foreground">
        <Phone className="size-3.5" />
        Call ended
      </Button>
    )
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="outline"
        size="sm"
        className="gap-2"
        onClick={startCall}
        disabled={callState === "registering"}
      >
        <Phone className="size-3.5" />
        {callState === "registering" ? "Connecting…" : `Call ${brokerName ?? brokerPhone}`}
      </Button>
      {error && <p className="text-xs text-destructive max-w-48 text-right">{error}</p>}
    </div>
  )
}
