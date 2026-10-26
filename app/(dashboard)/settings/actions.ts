"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isAdminInDb } from "@/lib/voice-agents/admin-check"
import { toE164 } from "@/lib/phone"

export async function updateAgentName(
  name: string,
): Promise<{ error?: string }> {
  const trimmed = name.trim()
  if (!trimmed) return { error: "Name cannot be empty" }
  if (trimmed.length > 80) return { error: "Name too long" }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  const { error } = await (supabase.from("agents") as any)
    .update({ name: trimmed })
    .eq("user_id", user.id)

  if (error) return { error: error.message }
  revalidatePath("/settings")
  return {}
}

// The callback number the call script says on voicemails and writes in emails ([number] / [Phone]).
// Admin only (role read from the database); an empty value clears it.
export async function setCallbackPhone(raw: string): Promise<{ error?: string; saved?: string | null }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }
  if (!(await isAdminInDb(createAdminClient(), user.id))) return { error: "admin only" }

  const text = raw.trim()
  let value: string | null = null
  if (text) {
    value = toE164(text)
    if (!value) return { error: "That is not a valid phone number" }
  }
  const { error } = (await (supabase.from("app_settings") as any).upsert({
    key: "callback_phone",
    value,
    updated_at: new Date().toISOString(),
  })) as { error: { message: string } | null }
  if (error) return { error: error.message }
  revalidatePath("/settings")
  revalidatePath("/leads")
  return { saved: value }
}
