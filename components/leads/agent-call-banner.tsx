"use client"

import { Clock } from "lucide-react"
import { useNow } from "@/lib/timezone/use-now"
import { formatAgentTimeAt } from "@/lib/timezone/broker-time"
import type { AgentCallState } from "@/lib/agent-call-rules"
import { countdown, useAgentCallState } from "./use-agent-call-state"

// Agents only (the admin has no limits): the broker cooldown banner and the
// "Calls this hour" counter on the lead page. Shares its state with the Call button.
export function AgentCallBanner({ leadId, initialState }: { leadId: string; initialState: AgentCallState | null }) {
  const now = useNow()
  const { state } = useAgentCallState(leadId, initialState, true)
  if (!state) return null

  const cooldownLeft = countdown(state.cooldown.until, now)
  const hourlyLeft = countdown(state.hourly.blockedUntil, now)

  return (
    <div className="space-y-2">
      {cooldownLeft && state.cooldown.until && now && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-800 dark:text-amber-300 animate-in-fade">
          <Clock className="size-4 shrink-0" />
          <span>
            Cooldown — call again after{" "}
            <span className="font-medium tabular-nums">{formatAgentTimeAt(new Date(state.cooldown.until), now, state.viewerTz)}</span>
          </span>
          <span className="text-xs opacity-80">This broker was tried twice without an answer · {cooldownLeft} left</span>
        </div>
      )}
      {hourlyLeft && state.hourly.message && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-800 dark:text-amber-300 animate-in-fade">
          <Clock className="size-4 shrink-0" />
          <span>{state.hourly.message}</span>
        </div>
      )}
      <p className="text-xs text-muted-foreground tabular-nums">
        Calls this hour: {state.hourly.count}/{state.hourly.limit}
      </p>
    </div>
  )
}
