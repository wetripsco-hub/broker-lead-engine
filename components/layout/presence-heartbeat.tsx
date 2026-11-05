"use client"

import { useEffect } from "react"
import { heartbeat } from "@/app/(dashboard)/presence-actions"
import { HEARTBEAT_SECONDS } from "@/lib/presence"

// Tells the admin's Agents page this agent is online. Only beats while the
// tab is visible, so a forgotten background tab doesn't look like work.
export function PresenceHeartbeat() {
  useEffect(() => {
    // Fallback for the agent's time zone when the server has no IP header (localhost).
    let browserTz: string | null = null
    try {
      browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null
    } catch {
      /* ignore */
    }
    const beat = () => {
      if (document.visibilityState === "visible") heartbeat(browserTz).catch(() => {})
    }
    beat()
    const id = setInterval(beat, HEARTBEAT_SECONDS * 1000)
    document.addEventListener("visibilitychange", beat)
    return () => {
      clearInterval(id)
      document.removeEventListener("visibilitychange", beat)
    }
  }, [])
  return null
}
