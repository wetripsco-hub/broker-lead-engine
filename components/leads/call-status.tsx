import {
  CALL_START_HOUR,
  CALL_END_HOUR,
  formatAgentTimeAt,
  formatDuration,
  type CallState,
  type CallStatus,
} from "@/lib/timezone/broker-time"

export type CallDisplayState = CallState | "unknown"

// Green / amber / red / gray, as pill + dot classes. Colors cross-fade with a
// short ease-out transition (they change state a few times an hour at most —
// no motion beyond that, since the clock itself ticks every second).
export const CALL_STATE_STYLES: Record<CallDisplayState, { dot: string; badge: string }> = {
  ok: {
    dot: "bg-green-500",
    badge: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  },
  closing: {
    dot: "bg-amber-500",
    badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  },
  closed: {
    dot: "bg-red-500",
    badge: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  },
  weekend: {
    dot: "bg-gray-400",
    badge: "bg-muted text-muted-foreground",
  },
  unknown: {
    dot: "bg-gray-300 dark:bg-gray-600",
    badge: "bg-muted text-muted-foreground",
  },
}

export function CallDot({ state, className = "" }: { state: CallDisplayState; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block size-2 shrink-0 rounded-full transition-colors duration-200 ease-[var(--ease-out)] ${CALL_STATE_STYLES[state].dot} ${className}`}
    />
  )
}

export function fmtHour(h: number): string {
  const suffix = h >= 12 ? "PM" : "AM"
  return `${h % 12 === 0 ? 12 : h % 12}:00 ${suffix}`
}

export const CALL_WINDOW_LABEL = `${fmtHour(CALL_START_HOUR)} – ${fmtHour(CALL_END_HOUR)}`

// The words for each state, shared by the lead-page card and the list tooltip.
export function describeCall(status: CallStatus, now: Date): { headline: string; detail: string } {
  switch (status.state) {
    case "ok":
      return { headline: "OK to call", detail: `Window closes in ${formatDuration(status.minutesUntilClose ?? 0)}` }
    case "closing":
      return { headline: `Closing in ${status.minutesUntilClose}m`, detail: "Call now or wait until the next window" }
    case "closed":
      return {
        headline: "Outside calling hours",
        detail: status.opensAt
          ? `Opens in ${formatDuration(status.minutesUntilOpen ?? 0)} · Call at ${formatAgentTimeAt(status.opensAt, now)}`
          : "",
      }
    case "weekend":
      return {
        headline: "Weekend - best to call Monday",
        detail: status.opensAt ? `Call at ${formatAgentTimeAt(status.opensAt, now)}` : "",
      }
  }
}
