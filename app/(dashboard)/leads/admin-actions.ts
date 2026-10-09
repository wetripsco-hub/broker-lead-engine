"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isAdminInDb } from "@/lib/voice-agents/admin-check"
import {
  deleteLead as runDelete,
  editLead as runEdit,
  type LeadAdminDeps,
  type LeadEditInput,
  type LeadSnapshot,
  type OpResult,
} from "@/lib/leads/admin-ops"

// Admin-only. The role is read from the database (isAdminInDb); row-level
// security on leads/brokers is a second lock behind it.
async function deps(): Promise<LeadAdminDeps> {
  const supabase = await createClient()
  return {
    async getUser() {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      return user ? { id: user.id, email: user.email ?? null } : null
    },
    isAdmin: (userId) => isAdminInDb(createAdminClient(), userId),
    async loadLead(leadId): Promise<LeadSnapshot | null> {
      const { data } = await (supabase.from("leads") as any)
        .select("id, stage, assigned_agent_id, broker_id, brokers ( * )")
        .eq("id", leadId)
        .maybeSingle()
      if (!data) return null
      const { count } = await (supabase.from("outreach_events") as any)
        .select("id", { count: "exact", head: true })
        .eq("lead_id", leadId)
      return {
        leadId: data.id,
        brokerId: data.broker_id,
        stage: data.stage,
        assignedAgentId: data.assigned_agent_id,
        broker: (data.brokers ?? {}) as Record<string, unknown>,
        eventCount: count ?? 0,
      }
    },
    async updateBroker(brokerId, patch) {
      const { data, error } = await (supabase.from("brokers") as any).update(patch).eq("id", brokerId).select("id")
      if (error) return { error: error.message, duplicate: error.code === "23505" }
      if (!data || data.length === 0) return { error: "Nothing was updated (no permission?)" }
      return { error: null }
    },
    async deleteLeadRow(leadId) {
      const { data, error } = await (supabase.from("leads") as any).delete().eq("id", leadId).select("id")
      return { deleted: data?.length ?? 0, error: error ? error.message : null }
    },
    async recordAudit(e) {
      const { error } = await (supabase.from("lead_changes") as any).insert({
        user_id: e.userId,
        user_email: e.userEmail,
        action: e.action,
        lead_id: e.leadId,
        company_name: e.company,
        mc_number: e.mcNumber,
        details: e.details,
      })
      return !error
    },
  }
}

export async function updateLeadDetails(leadId: string, input: LeadEditInput): Promise<OpResult> {
  const res = await runEdit(leadId, input, await deps())
  if (res.ok) {
    revalidatePath(`/leads/${leadId}`)
    revalidatePath("/leads")
  }
  return res
}

export async function deleteLeadPermanently(leadId: string, confirmation: string): Promise<OpResult> {
  const res = await runDelete(leadId, confirmation, await deps())
  if (res.ok) {
    revalidatePath("/leads")
    revalidatePath("/dashboard")
  }
  return res
}
