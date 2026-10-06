"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { Speaker, Turn } from "@/lib/copilot/types"

export interface Bubble {
  id: number
  speaker: Speaker
  /** Finalised text. */
  text: string
  /** Not-yet-final words, shown lighter. */
  interim: string
  /** True once Deepgram reported an endpoint (speech_final) for this utterance. */
  closed: boolean
}

export type TranscriptionStatus = "off" | "connecting" | "live" | "reconnecting" | "unavailable"

export interface MediaSources {
  /** Broker audio (Telnyx remote stream). */
  remote: MediaStream | null
  /** Agent audio (local mic). */
  local: MediaStream | null
}

interface Options {
  enabled: boolean
  getSources: () => MediaSources
  onBrokerActivity: () => void
  onBrokerUtterance: () => void
}

// nova-3, en-US, interim results, smart formatting, 800 ms endpointing.
const LISTEN_URL =
  "wss://api.deepgram.com/v1/listen?model=nova-3&language=en-US&interim_results=true&smart_format=true&endpointing=800"
const MAX_ATTEMPTS = 8

interface Channel {
  speaker: Speaker
  stream: MediaStream
  ws: WebSocket | null
  recorder: MediaRecorder | null
  attempts: number
  retryTimer: ReturnType<typeof setTimeout> | null
  live: boolean
}

/**
 * Live transcription of the two sides of a call over two separate Deepgram
 * streams (broker = remote audio, agent = local mic). Nothing connects while
 * `enabled` is false. Browsers get a short-lived token from our server — the
 * real Deepgram key never reaches the client.
 */
export function useTranscription({ enabled, getSources, onBrokerActivity, onBrokerUtterance }: Options) {
  const [bubbles, setBubbles] = useState<Bubble[]>([])
  const [status, setStatus] = useState<TranscriptionStatus>("off")

  const idRef = useRef(0)
  const channelsRef = useRef<Channel[]>([])
  const cbRef = useRef({ onBrokerActivity, onBrokerUtterance, getSources })
  cbRef.current = { onBrokerActivity, onBrokerUtterance, getSources }

  const recomputeStatus = useCallback(() => {
    const chs = channelsRef.current
    if (chs.length === 0) return setStatus("connecting")
    if (chs.every((c) => c.attempts >= MAX_ATTEMPTS && !c.live)) return setStatus("unavailable")
    if (chs.some((c) => !c.live && c.attempts > 0)) return setStatus("reconnecting")
    setStatus(chs.every((c) => c.live) ? "live" : "connecting")
  }, [])

  const applyResult = useCallback((speaker: Speaker, text: string, isFinal: boolean, speechFinal: boolean) => {
    if (!text) return
    if (speaker === "broker") cbRef.current.onBrokerActivity()
    setBubbles((prev) => {
      const next = [...prev]
      let i = next.length - 1
      while (i >= 0 && !(next[i].speaker === speaker && !next[i].closed)) i--
      if (i < 0) {
        next.push({ id: ++idRef.current, speaker, text: "", interim: "", closed: false })
        i = next.length - 1
      }
      const b = { ...next[i] }
      if (isFinal) {
        b.text = b.text ? `${b.text} ${text}` : text
        b.interim = ""
        if (speechFinal) b.closed = true
      } else {
        b.interim = text
      }
      next[i] = b
      return next
    })
    if (speaker === "broker" && isFinal && speechFinal) cbRef.current.onBrokerUtterance()
  }, [])

  const connect = useCallback(
    async (ch: Channel) => {
      try {
        const res = await fetch("/api/copilot/token", { method: "POST" })
        if (!res.ok) throw new Error("token")
        const { token } = (await res.json()) as { token: string }
        if (!channelsRef.current.includes(ch)) return // disabled meanwhile

        // Browsers can't set an Authorization header on a WebSocket; Deepgram
        // accepts the temporary token as ?access_token=.
        const ws = new WebSocket(`${LISTEN_URL}&access_token=${encodeURIComponent(token)}`)
        ch.ws = ws

        ws.onopen = () => {
          ch.live = true
          ch.attempts = 0
          recomputeStatus()
          const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : undefined
          const recorder = new MediaRecorder(ch.stream, mime ? { mimeType: mime } : undefined)
          ch.recorder = recorder
          recorder.ondataavailable = (e) => {
            if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) ws.send(e.data)
          }
          recorder.start(250)
        }
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data as string)
            if (msg.type !== "Results") return
            const text: string = msg.channel?.alternatives?.[0]?.transcript ?? ""
            applyResult(ch.speaker, text.trim(), !!msg.is_final, !!msg.speech_final)
          } catch {
            /* ignore non-JSON frames */
          }
        }
        ws.onclose = () => {
          ch.live = false
          if (ch.recorder && ch.recorder.state !== "inactive") ch.recorder.stop()
          ch.recorder = null
          if (channelsRef.current.includes(ch)) scheduleRetry(ch)
        }
        ws.onerror = () => ws.close()
      } catch {
        if (channelsRef.current.includes(ch)) scheduleRetry(ch)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [applyResult, recomputeStatus],
  )

  function scheduleRetry(ch: Channel) {
    ch.attempts++
    recomputeStatus()
    if (ch.attempts >= MAX_ATTEMPTS) return
    ch.retryTimer = setTimeout(() => connect(ch), Math.min(1000 * 2 ** (ch.attempts - 1), 8000))
  }

  const teardown = useCallback(() => {
    for (const ch of channelsRef.current) {
      if (ch.retryTimer) clearTimeout(ch.retryTimer)
      if (ch.recorder && ch.recorder.state !== "inactive") ch.recorder.stop()
      if (ch.ws && ch.ws.readyState === WebSocket.OPEN) {
        try {
          ch.ws.send(JSON.stringify({ type: "CloseStream" }))
        } catch {}
      }
      ch.ws?.close()
    }
    channelsRef.current = []
  }, [])

  useEffect(() => {
    if (!enabled) {
      teardown()
      setStatus("off")
      return
    }
    setStatus("connecting")
    let cancelled = false

    // The remote stream only exists once the call is answered, so poll until
    // both sides are available.
    const poll = setInterval(() => {
      if (cancelled) return
      const { remote, local } = cbRef.current.getSources()
      if (!remote || !local) return
      clearInterval(poll)
      const mk = (speaker: Speaker, s: MediaStream): Channel => ({
        speaker,
        // Audio-only copy: leaves the original (and mute state) untouched.
        stream: new MediaStream(s.getAudioTracks()),
        ws: null,
        recorder: null,
        attempts: 0,
        retryTimer: null,
        live: false,
      })
      channelsRef.current = [mk("broker", remote), mk("agent", local)]
      channelsRef.current.forEach((c) => connect(c))
    }, 500)

    return () => {
      cancelled = true
      clearInterval(poll)
      teardown()
    }
  }, [enabled, connect, teardown])

  const turnsRef = useRef<Turn[]>([])
  turnsRef.current = bubbles
    .filter((b) => b.text.trim())
    .map((b) => ({ speaker: b.speaker, text: b.text.trim() }))

  return { bubbles, status, getTurns: () => turnsRef.current }
}
