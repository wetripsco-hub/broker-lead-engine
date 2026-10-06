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
  revalidatePath("/dashboard")
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

export async function bulkAssignLeads(leadIds: string[], agentId: string | null) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user?.user_metadata?.role !== "admin") return { error: "admin only" }
  if (leadIds.length === 0) return { error: "No leads selected" }

  const { error } = await (supabase.from("leads") as any)
    .update({ assigned_agent_id: agentId })
    .in("id", leadIds) as { error: { message: string } | null }

  if (error) return { error: error.message }
  revalidatePath("/leads")
  return { error: null }
}

// Hides the follow-up flag until `days` from now. RLS limits agents to
// their own leads.
export async function snoozeFollowUp(leadId: string, days: number) {
  if (!Number.isFinite(days) || days <= 0) return { error: "Invalid snooze length" }
  const until = new Date(Date.now() + days * 86_400_000).toISOString()
  const supabase = await createClient()
  const { error } = await (supabase.from("leads") as any)
    .update({ follow_up_snoozed_until: until })
    .eq("id", leadId) as { error: { message: string } | null }

  if (error) return { error: error.message }
  revalidatePath("/leads")
  revalidatePath(`/leads/${leadId}`)
  revalidatePath("/dashboard")
  return { error: null }
}
