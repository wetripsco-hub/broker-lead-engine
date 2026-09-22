"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import type { LeadStage } from "@/types/database"

export async function updateLeadStage(leadId: string, stage: LeadStage) {
  const supabase = await createClient()
  const { error } = await (supabase.from("leads") as any).update({ stage }).eq("id", leadId) as { error: { message: string } | null }

  if (error) return { error: error.message }
  revalidatePath("/leads")
  revalidatePath(`/leads/${leadId}`)
  return { error: null }
}

export async function updateLeadNotes(leadId: string, notes: string) {
  const supabase = await createClient()
  const { error } = await (supabase.from("leads") as any).update({ notes: notes.trim() || null }).eq("id", leadId) as { error: { message: string } | null }

  if (error) return { error: error.message }
  revalidatePath(`/leads/${leadId}`)
  return { error: null }
}

export async function assignLead(leadId: string, agentId: string | null) {
  const supabase = await createClient()

  // Only admins can reassign
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user?.user_metadata?.role !== "admin") return { error: "admin only" }

  const { error } = await (supabase.from("leads") as any).update({ assigned_agent_id: agentId }).eq("id", leadId) as { error: { message: string } | null }

  if (error) return { error: error.message }
  revalidatePath("/leads")
  revalidatePath(`/leads/${leadId}`)
  return { error: null }
}
