// Server-side reads for the broker cooldown. Uses the service role on purpose:
// another agent's (or the admin's) attempts on the same broker must count,
// and RLS would hide them from the agent.

import { createAdminClient } from "@/lib/supabase/admin"
import { evaluateCooldown, isUnansweredStatus, cooldownMessage, type CooldownResult } from "@/lib/call-cooldown"
import { minutesUntil } from "@/lib/agent-hourly-limit"
import { formatAgentTimeAt } from "@/lib/timezone/broker-time"

const LOOKBACK_MS = 24 * 3600_000

export async function checkCallCooldown(
  leadId: string,
  now: Date = new Date(),
): Promise<CooldownResult & { message: string | null }> {
  const admin = createAdminClient() as any
  const { data: lead } = await admin.from("leads").select("broker_id").eq("id", leadId).maybeSingle()
  const brokerId = (lead as { broker_id: string | null } | null)?.broker_id
  if (!brokerId) return { blocked: false, until: null, streak: 0, message: null }

  const { data: leadRows } = await admin.from("leads").select("id").eq("broker_id", brokerId)
  const leadIds = ((leadRows ?? []) as Array<{ id: string }>).map((l) => l.id)
  if (leadIds.length === 0) return { blocked: false, until: null, streak: 0, message: null }

  const { data: events } = await admin
    .from("outreach_events")
    .select("status, occurred_at")
    .in("lead_id", leadIds)
    .in("channel", ["call", "ai_call"])
    .eq("direction", "outbound")
    .gte("occurred_at", new Date(now.getTime() - LOOKBACK_MS).toISOString())
    .order("occurred_at", { ascending: false })
    .limit(200)

  const attempts = ((events ?? []) as Array<{ status: string | null; occurred_at: string }>).map((e) => ({
    at: new Date(e.occurred_at),
    unanswered: isUnansweredStatus(e.status),
  }))
  const result = evaluateCooldown(attempts, now)
  return {
    ...result,
    message: result.blocked && result.until
      ? cooldownMessage(formatAgentTimeAt(result.until, now), minutesUntil(result.until, now))
      : null,
  }
}
