"use server"

import { createClient } from "@/lib/supabase/server"

/** Heartbeat from an open dashboard tab: stamps the signed-in user's own agent row. */
export async function heartbeat(): Promise<void> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return
  // RLS agents_update: user_id = auth.uid(). Errors (e.g. column not there yet) are ignored.
  await (supabase.from("agents") as any).update({ last_seen_at: new Date().toISOString() }).eq("user_id", user.id)
}
