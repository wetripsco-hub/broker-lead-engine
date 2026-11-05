"use server"

import { createClient } from "@/lib/supabase/server"
import { recordAgentLocation } from "@/lib/timezone/viewer-timezone"

/**
 * Heartbeat from an open dashboard tab: stamps the signed-in user's own agent row,
 * and saves their IP time zone / city / country when it changed. `browserTz` is the
 * browser's Intl zone, used only when Vercel's IP header is missing (e.g. localhost).
 */
export async function heartbeat(browserTz?: string | null): Promise<void> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return
  // RLS agents_update: user_id = auth.uid(). Errors (e.g. column not there yet) are ignored.
  await (supabase.from("agents") as any).update({ last_seen_at: new Date().toISOString() }).eq("user_id", user.id)
  await recordAgentLocation(user.id, typeof browserTz === "string" ? browserTz : null)
}
