// Server-side call rules that apply to agents only (never to the admin):
// calling hours with after-hours requests, the hourly call limit, and the
// broker cooldown. Read with the service role; callers must already have
// checked that the lead belongs to the signed-in agent.

import { createAdminClient } from "@/lib/supabase/admin"
import { checkCallingWindow } from "@/lib/timezone/calling-window"
import { AGENT_TZ, formatAgentTimeAt, formatLocalClock, formatLocalWeekday } from "@/lib/timezone/broker-time"
import { getAgentTimezone } from "@/lib/timezone/viewer-timezone"
import {
  evaluateHourlyLimit,
  hourlyLimitMessage,
  minutesUntil,
  HOURLY_CALL_LIMIT,
  HOURLY_WINDOW_MINUTES,
} from "@/lib/agent-hourly-limit"
import { checkCallCooldown } from "@/lib/call-cooldown-guard"

export const GRANT_MINUTES = 30

export type AfterHoursStatus = "pending" | "granted" | "denied" | "used" | "expired"

export interface AfterHoursRequestRow {
  id: string
  status: AfterHoursStatus
  note: string
  deny_reason: string | null
  requested_at: string
  expires_at: string | null
}

/** Everything the agent's Call button needs. All instants are ISO strings. */
export interface AgentCallState {
  /** The agent's own display zone (from their IP). Display only. */
  viewerTz: string
  window: {
    inside: boolean
    reason: "unknown_timezone" | "weekend" | "outside_hours" | null
    /** "7:42 PM Tue" in the broker's time, or null when the time zone is unknown. */
    brokerTime: string | null
  }
  request: {
    id: string
    status: AfterHoursStatus
    denyReason: string | null
    expiresAt: string | null
  } | null
  hourly: { count: number; limit: number; blockedUntil: string | null; message: string | null }
  cooldown: { until: string | null; message: string | null }
}

/** "7:42 PM Tue" */
export function brokerTimeLabel(tz: string, now: Date): string {
  return `${formatLocalClock(tz, now)} ${formatLocalWeekday(tz, now).slice(0, 3)}`
}

/** Grants past their 30 minutes become `expired` when they are read (no cron needed). */
export async function expireOldGrants(now: Date = new Date()): Promise<void> {
  await (createAdminClient().from("after_hours_requests") as any)
    .update({ status: "expired" })
    .eq("status", "granted")
    .lte("expires_at", now.toISOString())
}

/** The agent's latest request for this lead (after expiring old grants). */
export async function latestAfterHoursRequest(
  agentId: string,
  leadId: string,
  now: Date = new Date(),
): Promise<AfterHoursRequestRow | null> {
  await expireOldGrants(now)
  const { data } = await (createAdminClient().from("after_hours_requests") as any)
    .select("id, status, note, deny_reason, requested_at, expires_at")
    .eq("agent_id", agentId)
    .eq("lead_id", leadId)
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as AfterHoursRequestRow | null) ?? null
}

/** A grant this agent can use for this lead right now, if any. */
export async function activeGrant(agentId: string, leadId: string, now: Date = new Date()): Promise<{ id: string } | null> {
  const { data } = await (createAdminClient().from("after_hours_requests") as any)
    .select("id")
    .eq("agent_id", agentId)
    .eq("lead_id", leadId)
    .eq("status", "granted")
    .gt("expires_at", now.toISOString())
    .order("decided_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as { id: string } | null) ?? null
}

/**
 * Uses the grant for exactly one call. The `status = granted and not expired`
 * condition makes it atomic: two calls racing for one grant can't both win.
 */
export async function consumeGrant(grantId: string, eventId: string, now: Date = new Date()): Promise<boolean> {
  const { data } = await (createAdminClient().from("after_hours_requests") as any)
    .update({ status: "used", used_at: now.toISOString(), used_event_id: eventId })
    .eq("id", grantId)
    .eq("status", "granted")
    .gt("expires_at", now.toISOString())
    .select("id")
  return ((data ?? []) as unknown[]).length > 0
}

/** `tz` only changes how the "call again at" time is shown (the agent's own zone). */
export async function checkHourlyLimit(agentId: string, now: Date = new Date(), tz: string = AGENT_TZ) {
  const { data } = await (createAdminClient().from("outreach_events") as any)
    .select("occurred_at")
    .eq("agent_id", agentId)
    .eq("channel", "call")
    .eq("direction", "outbound")
    .gt("occurred_at", new Date(now.getTime() - HOURLY_WINDOW_MINUTES * 60_000).toISOString())
    .order("occurred_at", { ascending: false })
    .limit(HOURLY_CALL_LIMIT * 2)
  const attempts = ((data ?? []) as Array<{ occurred_at: string }>).map((e) => new Date(e.occurred_at))
  const r = evaluateHourlyLimit(attempts, now)
  return {
    ...r,
    message: r.blocked && r.blockedUntil
      ? hourlyLimitMessage(formatAgentTimeAt(r.blockedUntil, now, tz), minutesUntil(r.blockedUntil, now))
      : null,
  }
}

export async function getAgentCallState(
  agentId: string,
  leadId: string,
  broker: { state: string | null; phone: string | null },
  now: Date = new Date(),
): Promise<AgentCallState> {
  const w = checkCallingWindow(broker.state, broker.phone, now)
  const viewerTz = await getAgentTimezone(agentId)
  const [req, hourly, cooldown] = await Promise.all([
    latestAfterHoursRequest(agentId, leadId, now),
    checkHourlyLimit(agentId, now, viewerTz),
    checkCallCooldown(leadId, now, viewerTz),
  ])
  return {
    viewerTz,
    window: {
      inside: w.inside,
      reason: w.inside ? null : w.reason,
      brokerTime: w.tz ? brokerTimeLabel(w.tz.tz, now) : null,
    },
    request: req
      ? { id: req.id, status: req.status, denyReason: req.deny_reason, expiresAt: req.expires_at }
      : null,
    hourly: {
      count: hourly.count,
      limit: HOURLY_CALL_LIMIT,
      blockedUntil: hourly.blockedUntil?.toISOString() ?? null,
      message: hourly.message,
    },
    cooldown: { until: cooldown.until?.toISOString() ?? null, message: cooldown.message },
  }
}
