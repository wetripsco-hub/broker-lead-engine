"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isAdminInDb } from "@/lib/voice-agents/admin-check"

export async function resolveSupportRequest(id: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "admin only" }
  const admin = createAdminClient()
  if (!(await isAdminInDb(admin, user.id))) return { error: "admin only" }

  const { error } = await (admin.from("support_requests") as any)
    .update({ status: "resolved", resolved_at: new Date().toISOString(), resolved_by: user.id })
    .eq("id", id)
    .eq("status", "open")
  if (error) return { error: error.message }
  revalidatePath("/support-requests")
  return {}
}
