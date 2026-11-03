"use server"

import { createClient as createPlainClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { validateNewPassword } from "@/lib/support-request"

export interface ChangePasswordState {
  error: string | null
  success: string | null
}

// The signed-in user changes their own password. The current password is
// checked on a throw-away client so the real session cookies are untouched
// and the agent stays signed in.
export async function changeMyPassword(_prev: ChangePasswordState, formData: FormData): Promise<ChangePasswordState> {
  const current = String(formData.get("current") ?? "")
  const next = String(formData.get("next") ?? "")
  const confirm = String(formData.get("confirm") ?? "")

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email) return { error: "You are not signed in.", success: null }

  const invalid = validateNewPassword(current, next, confirm)
  if (invalid) return { error: invalid, success: null }

  const verifier = createPlainClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error: signInError } = await verifier.auth.signInWithPassword({ email: user.email, password: current })
  if (signInError) return { error: "Current password is incorrect", success: null }
  await verifier.auth.signOut({ scope: "local" })

  const { error } = await supabase.auth.updateUser({ password: next })
  if (error) return { error: error.message, success: null }
  return { error: null, success: "Password changed successfully" }
}
