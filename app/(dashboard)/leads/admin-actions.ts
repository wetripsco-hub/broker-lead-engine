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

export interface BulkConsentResult {
  error: string | null
  marked: number
  alreadyHad: number
  skippedDnc: number
  notFound: number
}

// Admin-only: records AI-call consent for several leads at once, with the same mandatory
// source text as the single-lead action. Leads already consented keep their original
// source/date (not overwritten), and do-not-call leads are never marked.
export async function markAiCallConsentBulk(leadIds: string[], source: string): Promise<BulkConsentResult> {
  const empty = { marked: 0, alreadyHad: 0, skippedDnc: 0, notFound: 0 }
  const text = source.trim()
  if (!text) return { error: "Say where the consent came from", ...empty }
  if (text.length > 300) return { error: "Source is too long", ...empty }
  const ids = [...new Set(leadIds)].filter((id) => /^[0-9a-f-]{36}$/i.test(id))
  if (ids.length === 0) return { error: "No leads selected", ...empty }
  if (ids.length > 500) return { error: "Select at most 500 leads at a time", ...empty }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not signed in", ...empty }
  if (!(await isAdminInDb(createAdminClient(), user.id))) return { error: "admin only", ...empty }

  const { data, error: loadErr } = await (supabase.from("leads") as any)
    .select("id, ai_call_consent, do_not_call")
    .in("id", ids)
  if (loadErr) return { error: loadErr.message, ...empty }
  const rows = (data ?? []) as Array<{ id: string; ai_call_consent: boolean; do_not_call: boolean }>

  const toMark = rows.filter((r) => !r.ai_call_consent && !r.do_not_call).map((r) => r.id)
  const result = {
    marked: 0,
    alreadyHad: rows.filter((r) => r.ai_call_consent).length,
    skippedDnc: rows.filter((r) => !r.ai_call_consent && r.do_not_call).length,
    notFound: ids.length - rows.length,
  }
  if (toMark.length > 0) {
    const { data: done, error } = await (supabase.from("leads") as any)
      .update({
        ai_call_consent: true,
        ai_call_consent_source: text,
        ai_call_consent_at: new Date().toISOString(),
      })
      .in("id", toMark)
      .select("id")
    if (error) return { error: error.message, ...result }
    result.marked = done?.length ?? 0
  }
  revalidatePath("/leads")
  return { error: null, ...result }
}
