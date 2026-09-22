"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"

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
