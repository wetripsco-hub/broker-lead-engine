"use client"

import { useCallback, useEffect, useState } from "react"
import { getMyCallState } from "@/app/(dashboard)/leads/[id]/call-actions"
import type { AgentCallState } from "@/lib/agent-call-rules"

// One poll per lead, shared by every component on the page that shows the
// agent's call state (the Call button and the banner), so they never disagree
// and the server isn't asked twice.
const POLL_MS = 15_000

interface Store {
  state: AgentCallState | null
  listeners: Set<(s: AgentCallState | null) => void>
  timer: ReturnType<typeof setInterval> | null
}
const stores = new Map<string, Store>()

async function refreshStore(leadId: string) {
  const store = stores.get(leadId)
  if (!store) return
  const { state } = await getMyCallState(leadId).catch(() => ({ state: null as AgentCallState | null }))
  if (!state) return
  store.state = state
  store.listeners.forEach((l) => l(state))
}

export function useAgentCallState(leadId: string, initial: AgentCallState | null, enabled: boolean) {
  const [state, setState] = useState<AgentCallState | null>(initial)

  useEffect(() => {
    if (!enabled) return
    let store = stores.get(leadId)
    if (!store) {
      store = { state: initial, listeners: new Set(), timer: null }
      stores.set(leadId, store)
    } else if (store.state) {
      setState(store.state)
    }
    store.listeners.add(setState)
    if (!store.timer) store.timer = setInterval(() => refreshStore(leadId), POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshStore(leadId)
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      document.removeEventListener("visibilitychange", onVisible)
      const s = stores.get(leadId)
      if (!s) return
      s.listeners.delete(setState)
      if (s.listeners.size === 0) {
        if (s.timer) clearInterval(s.timer)
        stores.delete(leadId)
      }
    }
    // `initial` is only the first value; later values come from the poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, enabled])

  const refresh = useCallback(() => refreshStore(leadId), [leadId])
  return { state, refresh }
}

/** "4:05" — minutes and seconds left until `iso`, or null once it has passed. */
export function countdown(iso: string | null, now: Date | null): string | null {
  if (!iso || !now) return null
  const ms = new Date(iso).getTime() - now.getTime()
  if (ms <= 0) return null
  const total = Math.ceil(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}
