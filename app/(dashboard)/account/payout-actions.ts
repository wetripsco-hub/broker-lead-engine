"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { validatePayoutDetails } from "@/lib/payout-details"

/** The signed-in agent saves where their commission is paid. Row-level security limits it to their own row. */
export async function savePayoutDetails(input: Record<string, unknown>): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Please sign in again." }

  const { data: agent } = await (supabase.from("agents") as any).select("id").eq("user_id", user.id).maybeSingle()
  if (!agent) return { error: "No agent account found for this login." }

  const parsed = validatePayoutDetails(input)
  if (!parsed.ok) return { error: parsed.error }

  const { error } = await (supabase.from("agent_payout_details") as any).upsert(
    { agent_id: (agent as { id: string }).id, ...parsed.value },
    { onConflict: "agent_id" },
  )
  if (error) return { error: "Could not save. Please try again." }

  revalidatePath("/account")
  revalidatePath("/payouts")
  return { error: null }
}
