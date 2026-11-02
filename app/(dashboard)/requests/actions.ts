"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isAdminInDb } from "@/lib/voice-agents/admin-check"
import { GRANT_MINUTES } from "@/lib/agent-call-rules"

async function requireAdmin(): Promise<{ userId: string } | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  return (await isAdminInDb(createAdminClient(), user.id)) ? { userId: user.id } : null
}

/** Allows exactly one call within the next 30 minutes. Only a pending request can be granted. */
export async function grantAfterHoursRequest(id: string): Promise<{ error?: string }> {
  const me = await requireAdmin()
  if (!me) return { error: "admin only" }
  const now = new Date()
  const { data, error } = await (createAdminClient().from("after_hours_requests") as any)
    .update({
      status: "granted",
      decided_at: now.toISOString(),
      decided_by: me.userId,
      expires_at: new Date(now.getTime() + GRANT_MINUTES * 60_000).toISOString(),
    })
    .eq("id", id)
    .eq("status", "pending")
    .select("id, lead_id")
  if (error) return { error: error.message }
  const row = ((data ?? []) as Array<{ id: string; lead_id: string }>)[0]
  if (!row) return { error: "This request was already decided." }
  revalidatePath("/requests")
  revalidatePath(`/leads/${row.lead_id}`)
  return {}
}

export async function denyAfterHoursRequest(id: string, reason: string): Promise<{ error?: string }> {
  const me = await requireAdmin()
  if (!me) return { error: "admin only" }
  const text = reason.trim().slice(0, 500)
  const { data, error } = await (createAdminClient().from("after_hours_requests") as any)
    .update({
      status: "denied",
      decided_at: new Date().toISOString(),
      decided_by: me.userId,
      deny_reason: text || null,
    })
    .eq("id", id)
    .eq("status", "pending")
    .select("id, lead_id")
  if (error) return { error: error.message }
  const row = ((data ?? []) as Array<{ id: string; lead_id: string }>)[0]
  if (!row) return { error: "This request was already decided." }
  revalidatePath("/requests")
  revalidatePath(`/leads/${row.lead_id}`)
  return {}
}
