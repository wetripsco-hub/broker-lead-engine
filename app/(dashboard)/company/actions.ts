"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isAdminInDb } from "@/lib/voice-agents/admin-check"

const MAX_CHARS = 100_000

export async function saveCompanyInfo(body: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }
  if (!(await isAdminInDb(createAdminClient(), user.id))) return { error: "admin only" }
  if (body.length > MAX_CHARS) return { error: `Too long (max ${MAX_CHARS.toLocaleString()} characters)` }

  const { error } = await (supabase.from("company_info") as any).upsert({
    id: 1,
    body,
    updated_at: new Date().toISOString(),
    updated_by: user.id,
  })
  if (error) return { error: error.message }
  revalidatePath("/company")
  return {}
}
