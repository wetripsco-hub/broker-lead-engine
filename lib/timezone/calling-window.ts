// "May we call this broker right now?" — Monday–Friday, 8 AM–6 PM in the
// broker's local time. Shared by the AI-call gate and the agents' manual-call
// check so both use exactly the same window. Pure: the instant is passed in.

import { getCallStatus, resolveTimezone, type ResolvedTimezone } from "@/lib/timezone/broker-time"

const HOUR = 3600_000

export type CallingWindowResult =
  | { inside: true; tz: ResolvedTimezone }
  | { inside: false; reason: "unknown_timezone"; tz: null }
  | { inside: false; reason: "weekend" | "outside_hours"; tz: ResolvedTimezone }

export function checkCallingWindow(
  state: string | null | undefined,
  phone: string | null | undefined,
  now: Date,
): CallingWindowResult {
  const tz = resolveTimezone(state, phone)
  if (!tz) return { inside: false, reason: "unknown_timezone", tz: null }
  // For states split across zones the zone is a best guess, so the whole
  // window must hold an hour either side too. "closing" counts as inside.
  const probes = tz.approximate ? [now, new Date(now.getTime() - HOUR), new Date(now.getTime() + HOUR)] : [now]
  for (const t of probes) {
    const s = getCallStatus(tz.tz, t).state
    if (s === "weekend") return { inside: false, reason: "weekend", tz }
    if (s === "closed") return { inside: false, reason: "outside_hours", tz }
  }
  return { inside: true, tz }
}
