"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Stars or un-stars a lead for the signed-in user only. Row-level security makes
 * it personal (you only ever touch your own rows) and only allows leads you can see.
 */
export async function setLeadFavorite(leadId: string, favorite: boolean): Promise<{ error?: string }> {
  if (!UUID.test(leadId)) return { error: "Invalid lead" }
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not signed in" }

  const table = supabase.from("lead_favorites") as any
  const { error } = favorite
    ? await table.upsert({ user_id: user.id, lead_id: leadId }, { onConflict: "user_id,lead_id", ignoreDuplicates: true })
    : await table.delete().eq("user_id", user.id).eq("lead_id", leadId)

  if (error) {
    // 42P01 = the table doesn't exist yet (migration not run).
    return { error: error.code === "42P01" || /lead_favorites/.test(error.message) ? "Favorites aren't set up yet. Ask an admin to run the favorites migration." : "Couldn't update the favorite" }
  }
  revalidatePath("/leads")
  revalidatePath(`/leads/${leadId}`)
  return {}
}
