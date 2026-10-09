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

// Admin-only: records that this lead agreed to be called by the AI agent.
// The source (where/how consent was given) is mandatory so there is always a
// record of it. The database also blocks non-admins from changing these fields.
export async function markAiCallConsent(leadId: string, source: string) {
  const text = source.trim()
  if (!text) return { error: "Say where the consent came from" }
  if (text.length > 300) return { error: "Source is too long" }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user?.user_metadata?.role !== "admin") return { error: "admin only" }

  const { error } = await (supabase.from("leads") as any)
    .update({
      ai_call_consent: true,
      ai_call_consent_source: text,
      ai_call_consent_at: new Date().toISOString(),
    })
    .eq("id", leadId) as { error: { message: string } | null }

  if (error) return { error: error.message }
  revalidatePath(`/leads/${leadId}`)
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

const STAGES: LeadStage[] = ["new", "contacted", "interested", "converted", "dead"]

// Sets the stage on several leads at once. Row-level security limits agents to their own
// leads; `updated` is how many rows actually changed.
export async function bulkUpdateStage(leadIds: string[], stage: LeadStage) {
  if (!STAGES.includes(stage)) return { error: "Invalid stage", updated: 0 }
  const ids = [...new Set(leadIds)]
  if (ids.length === 0) return { error: "No leads selected", updated: 0 }
  if (ids.length > 500) return { error: "Select at most 500 leads at a time", updated: 0 }

  const supabase = await createClient()
  const { data, error } = (await (supabase.from("leads") as any).update({ stage }).in("id", ids).select("id")) as {
    data: Array<{ id: string }> | null
    error: { message: string } | null
  }
  if (error) return { error: error.message, updated: 0 }
  revalidatePath("/leads")
  revalidatePath("/dashboard")
  return { error: null, updated: data?.length ?? 0 }
}
