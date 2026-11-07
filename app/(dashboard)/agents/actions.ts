"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isAdminInDb } from "@/lib/voice-agents/admin-check"

type AdminCheck = { error: string } | { error?: undefined }

async function requireAdmin(): Promise<AdminCheck> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || user.app_metadata?.role !== "admin") return { error: "Admin access required" }
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
    // The role lives in app_metadata: only the service role can write it (user_metadata is user-editable).
    app_metadata: { role: "agent" },
  })
  if (createError) return { error: createError.message }

  // The on_auth_user_created trigger (handle_new_user) already inserted an
  // agents row for this user with name = email, so upsert on user_id to
  // fill in the real name/email instead of inserting a duplicate.
  const { error: upsertError } = await (admin.from("agents") as any).upsert(
    { user_id: created.user.id, name, email, active: true },
    { onConflict: "user_id" },
  )
  if (upsertError) {
    // Don't leave a login with no usable agent row behind it.
    await admin.auth.admin.deleteUser(created.user.id)
    return { error: upsertError.message }
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

  // left_at: payments received after this date earn no commission (re-enabling clears it).
  let { error } = await (admin.from("agents") as any)
    .update({ active, left_at: active ? null : new Date().toISOString() })
    .eq("id", agentId)
  // Earnings migration not applied yet (no left_at column): still enable/disable.
  if (error && /left_at/.test(error.message)) {
    ;({ error } = await (admin.from("agents") as any).update({ active }).eq("id", agentId))
  }
  if (error) return { error: error.message }

  revalidatePath("/agents")
  return { error: null }
}

/**
 * Pay terms (Platinum option): "salary_plus_commission" and/or a custom commission %
 * that replaces the level %. customRatePct null = use the level rate. Admin only.
 */
export async function setAgentComp(
  agentId: string,
  compType: "commission" | "salary_plus_commission",
  customRatePct: number | null,
): Promise<{ error: string | null }> {
  const check = await requireAdmin()
  if (check.error) return { error: check.error }
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const admin = createAdminClient()
  if (!user || !(await isAdminInDb(admin, user.id))) return { error: "Admin access required" }

  if (compType !== "commission" && compType !== "salary_plus_commission") return { error: "Unknown pay type" }
  let customRate: number | null = null
  if (customRatePct !== null && customRatePct !== undefined) {
    if (!Number.isFinite(customRatePct) || customRatePct < 0 || customRatePct > 100) return { error: "Custom % must be between 0 and 100" }
    customRate = Math.round(customRatePct * 100) / 10000
  }

  const { error } = await (admin.from("agents") as any)
    .update({ comp_type: compType, custom_rate: customRate })
    .eq("id", agentId)
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

async function adminUserId(): Promise<string | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user && user.app_metadata?.role === "admin" ? user.id : null
}

/** Name and login email. The email is the agent's login ID, so it changes in Auth too. */
export async function updateAgent(agentId: string, name: string, email: string): Promise<{ error: string | null }> {
  const check = await requireAdmin()
  if (check.error) return { error: check.error }

  const cleanName = name.trim()
  const cleanEmail = email.trim().toLowerCase()
  if (!cleanName) return { error: "Name is required" }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return { error: "Enter a valid email" }

  const admin = createAdminClient()
  const { data: agentRow } = await (admin.from("agents") as any)
    .select("user_id, email")
    .eq("id", agentId)
    .maybeSingle()
  if (!agentRow) return { error: "Agent not found" }
  const row = agentRow as { user_id: string; email: string | null }

  if (cleanEmail !== (row.email ?? "").toLowerCase()) {
    const { error: authError } = await admin.auth.admin.updateUserById(row.user_id, { email: cleanEmail, email_confirm: true })
    if (authError) {
      return { error: /already|registered|exists/i.test(authError.message) ? "Another account already uses this email" : authError.message }
    }
  }

  const { error } = await (admin.from("agents") as any).update({ name: cleanName, email: cleanEmail }).eq("id", agentId)
  if (error) {
    return { error: /duplicate|unique/i.test(error.message) ? "Another agent already uses this email" : error.message }
  }

  revalidatePath("/agents")
  return { error: null }
}

/**
 * Removes an agent. Their leads become unassigned. An agent with no outreach
 * history is deleted outright; one with history is archived so calls,
 * recordings and messages stay intact: the login is blocked and the row hidden.
 */
export async function deleteAgent(agentId: string): Promise<{ error: string | null; archived?: boolean }> {
  const me = await adminUserId()
  if (!me) return { error: "Admin access required" }

  const admin = createAdminClient()
  const { data: agentRow } = await (admin.from("agents") as any)
    .select("user_id")
    .eq("id", agentId)
    .maybeSingle()
  if (!agentRow) return { error: "Agent not found" }
  const userId = (agentRow as { user_id: string | null }).user_id

  if (userId === me) return { error: "You can't delete your own account" }
  if (userId) {
    const { data: authUser } = await admin.auth.admin.getUserById(userId)
    if (authUser?.user?.app_metadata?.role === "admin") return { error: "Admin accounts can't be deleted here" }
  }

  const [{ count }, { count: customerCount }] = await Promise.all([
    (admin.from("outreach_events") as any).select("id", { count: "exact", head: true }).eq("agent_id", agentId),
    // Customers and commission entries are history too (they point at the agent row).
    (admin.from("customers") as any).select("id", { count: "exact", head: true }).eq("agent_id", agentId),
  ])

  if ((count ?? 0) === 0 && (customerCount ?? 0) === 0) {
    // Deleting the auth user cascades to the agents row (and their requests/
    // tickets); leads.assigned_agent_id is ON DELETE SET NULL.
    if (userId) {
      const { error } = await admin.auth.admin.deleteUser(userId)
      if (error) return { error: error.message }
    }
    await (admin.from("agents") as any).delete().eq("id", agentId)
    revalidatePath("/agents")
    return { error: null, archived: false }
  }

  // Has history: the auth user can't be deleted (it would cascade into the
  // agents row that the history points at). Hide the row first (this fails
  // cleanly if the deleted_at migration isn't applied, before anything else
  // changes), then unassign the leads, then block the login for good and move
  // it to a placeholder email so the real address is free to reuse.
  const archived = { active: false, deleted_at: new Date().toISOString(), email: null }
  let { error: archiveError } = await (admin.from("agents") as any)
    .update({ ...archived, left_at: archived.deleted_at })
    .eq("id", agentId)
  if (archiveError && /left_at/.test(archiveError.message)) {
    ;({ error: archiveError } = await (admin.from("agents") as any).update(archived).eq("id", agentId))
  }
  if (archiveError) return { error: archiveError.message }

  const { error: unassignError } = await (admin.from("leads") as any).update({ assigned_agent_id: null }).eq("assigned_agent_id", agentId)
  if (unassignError) return { error: unassignError.message }

  if (userId) {
    const { error } = await admin.auth.admin.updateUserById(userId, {
      email: `deleted-${agentId}@deleted.invalid`,
      email_confirm: true,
      ban_duration: "876000h",
    })
    if (error) return { error: error.message }
  }

  revalidatePath("/agents")
  return { error: null, archived: true }
}

/**
 * Admin hands an account over: ticked, the welcome tour opens on the agent's
 * next sign-in (from the first step); finishing it unticks this again.
 */
export async function setWelcomeTour(agentId: string, show: boolean): Promise<{ error: string | null }> {
  const check = await requireAdmin()
  if (check.error) return { error: check.error }

  const { error } = await (createAdminClient().from("agents") as any)
    .update(show ? { onboarding_completed_at: null, onboarding_step: 0 } : { onboarding_completed_at: new Date().toISOString() })
    .eq("id", agentId)
  if (error) return { error: error.message }

  revalidatePath("/agents")
  return { error: null }
}
