"use server"

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireAgreementAdmin } from "@/lib/agreement/admin"

const UUID = /^[0-9a-f-]{36}$/i

/** The admin opened the Agreements tab: clear the "new" badge. */
export async function markAgreementsSeen(): Promise<{ error: string | null }> {
  const me = await requireAgreementAdmin()
  if (!me) return { error: "Admin access required" }
  const { error } = await (createAdminClient().from("agreement_admin_seen") as any).upsert(
    { admin_user_id: me.id, last_seen_at: new Date().toISOString() },
    { onConflict: "admin_user_id" },
  )
  if (error) return { error: error.message }
  revalidatePath("/", "layout")
  return { error: null }
}

/** Marks a signature as rejected (no account will be made). Only a still-open signature can be rejected. */
export async function rejectAgreement(id: string, note: string): Promise<{ error: string | null }> {
  const me = await requireAgreementAdmin()
  if (!me) return { error: "Admin access required" }
  if (!UUID.test(id)) return { error: "Unknown signature" }
  const cleanNote = note.trim().slice(0, 1000) || null
  const { data, error } = await (createAdminClient().from("agent_agreements") as any)
    .update({ status: "rejected", admin_note: cleanNote })
    .eq("id", id)
    .eq("status", "signed")
    .select("id")
  if (error) return { error: error.message }
  if (!data || data.length === 0) return { error: "This signature was already handled." }
  revalidatePath("/recruiter")
  return { error: null }
}
