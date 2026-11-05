// Server side of the agent's own time zone (doc/AGENT_TIMEZONE_RUNBOOK.md).
// Only for DISPLAY: the calling window, cooldown, hourly limit and after-hours
// grants keep using the broker's time zone and the server clock.

import { headers } from "next/headers"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isAdminInDb } from "@/lib/voice-agents/admin-check"
import { AGENT_TZ, safeTimezone } from "@/lib/timezone/broker-time"
import { locationChanged, locationFromHeaders } from "@/lib/timezone/viewer-location"

/** The saved zone of one agent row (validated), or PKT. Never throws. */
export async function getAgentTimezone(agentId: string): Promise<string> {
  try {
    // select("*") so a missing column (migration not run yet) just means PKT.
    const { data } = await (createAdminClient().from("agents") as any).select("*").eq("id", agentId).maybeSingle()
    return safeTimezone((data as { ip_timezone?: string | null } | null)?.ip_timezone)
  } catch {
    return AGENT_TZ
  }
}

/** The signed-in viewer's display zone: the agent's saved IP zone; PKT for the admin. */
export async function getViewerTimezone(): Promise<string> {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return AGENT_TZ
    if (await isAdminInDb(createAdminClient(), user.id)) return AGENT_TZ
    const { data } = await (supabase.from("agents") as any).select("*").eq("user_id", user.id).maybeSingle()
    return safeTimezone((data as { ip_timezone?: string | null } | null)?.ip_timezone)
  } catch {
    return AGENT_TZ
  }
}

/**
 * Saves where this request comes from on the user's agent row — only when it changed.
 * Service role, because agents can't write these columns themselves. Never throws.
 */
export async function recordAgentLocation(userId: string, browserTz: string | null | undefined): Promise<void> {
  try {
    const h = await headers()
    const next = locationFromHeaders((name) => h.get(name), browserTz)
    const admin = createAdminClient() as any
    const { data: row } = await admin.from("agents").select("*").eq("user_id", userId).maybeSingle()
    if (!row || !("ip_timezone" in row)) return // no agent row, or migration not run yet
    if (!locationChanged(row, next)) return
    await admin
      .from("agents")
      .update({
        ip_timezone: next.timezone,
        ip_country: next.country,
        ip_city: next.city,
        ip_location_at: new Date().toISOString(),
      })
      .eq("id", row.id)
  } catch {
    /* never break the heartbeat or sign-in over this */
  }
}
