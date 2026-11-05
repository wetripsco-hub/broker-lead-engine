"use server"

import { revalidatePath } from "next/cache"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { ONBOARDED_COOKIE } from "@/lib/onboarding"
import { recordAgentLocation } from "@/lib/timezone/viewer-timezone"
import {
  lockedMessage,
  lockedUntil,
  normaliseLoginEmail,
  registerFailure,
  wrongPasswordMessage,
  type LockoutRow,
} from "@/lib/login-lockout"

export interface LoginState {
  error: string | null
}

// The lockout table is service-role only (no RLS policies), so the browser can
// neither read nor reset it. If it can't be reached, sign-in still works.
async function readLockout(email: string): Promise<LockoutRow | null> {
  try {
    const { data } = await (createAdminClient().from("login_attempts") as any)
      .select("failed_count, first_failed_at, locked_until")
      .eq("email", email)
      .maybeSingle()
    return (data as LockoutRow | null) ?? null
  } catch {
    return null
  }
}

async function writeLockout(email: string, row: LockoutRow | null) {
  try {
    const table = createAdminClient().from("login_attempts") as any
    if (row) await table.upsert({ email, ...row, updated_at: new Date().toISOString() })
    else await table.delete().eq("email", email)
  } catch {
    /* never block sign-in on the counter itself */
  }
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const rawEmail = String(formData.get("email") ?? "")
  const password = String(formData.get("password") ?? "")
  const email = normaliseLoginEmail(rawEmail)
  if (!email || !password) return { error: "Enter your email and password." }

  // Locked: don't even try the password.
  const now = new Date()
  const before = await readLockout(email)
  const until = lockedUntil(before, now)
  if (until) return { error: lockedMessage(until, now) }

  const supabase = await createClient()
  const { data: signedIn, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    // Only a wrong email/password counts towards the lock, not e.g. a network error.
    const wrongCredentials = (error as { code?: string }).code === "invalid_credentials" || /invalid login credentials/i.test(error.message)
    if (!wrongCredentials) return { error: error.message }
    const result = registerFailure(before, new Date())
    await writeLockout(email, result.row)
    return { error: result.locked ? lockedMessage(new Date(result.row.locked_until!), new Date()) : wrongPasswordMessage(result.triesLeft) }
  }

  if (before) await writeLockout(email, null)
  // The agent's own time zone from their IP, so the first page already shows it.
  if (signedIn?.user) await recordAgentLocation(signedIn.user.id, String(formData.get("tz") ?? "") || null)
  // Re-check the welcome tour flag on every fresh sign-in.
  ;(await cookies()).delete(ONBOARDED_COOKIE)
  revalidatePath("/", "layout")
  redirect("/dashboard")
}

export async function logout() {
  const supabase = await createClient()
  // Shows as offline on the admin's Agents page straight away.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user) {
    await (supabase.from("agents") as any).update({ last_signed_out_at: new Date().toISOString() }).eq("user_id", user.id)
  }
  await supabase.auth.signOut()
  ;(await cookies()).delete(ONBOARDED_COOKIE)
  revalidatePath("/", "layout")
  redirect("/login")
}
