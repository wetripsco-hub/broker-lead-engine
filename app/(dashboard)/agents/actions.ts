"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

type AdminCheck = { error: string } | { error?: undefined }

async function requireAdmin(): Promise<AdminCheck> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || user.user_metadata?.role !== "admin") return { error: "Admin access required" }
  return {}
}

export async function createAgent(formData: FormData): Promise<{ error: string | null }> {
  const check = await requireAdmin()
  if (check.error) return { error: check.error }

  const name = (formData.get("name") as string)?.trim()
  const email = (formData.get("email") as string)?.trim().toLowerCase()
  const password = formData.get("password") as string

  if (!name || !email || !password) return { error: "Name, email and password are required" }
  if (password.length < 8) return { error: "Password must be at least 8 characters" }

  const admin = createAdminClient()

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { role: "agent" },
  })
  if (createError) return { error: createError.message }

  const { error: insertError } = await (admin.from("agents") as any).insert({
    user_id: created.user.id,
    name,
    email,
    active: true,
  })
  if (insertError) {
    // Don't leave a login with no agent row behind it.
    await admin.auth.admin.deleteUser(created.user.id)
    return { error: insertError.message }
  }

  revalidatePath("/agents")
  return { error: null }
}

// Disabling bans the auth user outright (not just an app-level flag) so a
// disabled agent genuinely can't sign in — matches "don't trust the UI,
// enforce it where it can't be bypassed."
export async function toggleAgentActive(agentId: string, active: boolean): Promise<{ error: string | null }> {
  const check = await requireAdmin()
  if (check.error) return { error: check.error }

  const admin = createAdminClient()
  const { data: agentRow } = await (admin.from("agents") as any)
    .select("user_id")
    .eq("id", agentId)
    .maybeSingle()
  if (!agentRow) return { error: "Agent not found" }

  const { error: banError } = await admin.auth.admin.updateUserById(
    (agentRow as { user_id: string }).user_id,
    { ban_duration: active ? "none" : "87600h" },
  )
  if (banError) return { error: banError.message }

  const { error } = await (admin.from("agents") as any).update({ active }).eq("id", agentId)
  if (error) return { error: error.message }

  revalidatePath("/agents")
  return { error: null }
}

export async function resetAgentPassword(agentId: string, newPassword: string): Promise<{ error: string | null }> {
  const check = await requireAdmin()
  if (check.error) return { error: check.error }
  if (newPassword.length < 8) return { error: "Password must be at least 8 characters" }

  const admin = createAdminClient()
  const { data: agentRow } = await (admin.from("agents") as any)
    .select("user_id")
    .eq("id", agentId)
    .maybeSingle()
  if (!agentRow) return { error: "Agent not found" }

  const { error } = await admin.auth.admin.updateUserById(
    (agentRow as { user_id: string }).user_id,
    { password: newPassword },
  )
  if (error) return { error: error.message }
  return { error: null }
}
