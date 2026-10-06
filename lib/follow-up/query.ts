import type { SupabaseClient } from "@supabase/supabase-js"
import { evaluateFollowUp, type FollowUpInfo, type FollowUpRow } from "./compute"

const COLUMNS =
  "lead_id, stage, follow_up_snoozed_until, last_outbound_email_at, last_inbound_email_at, replied, follow_up_count"

/**
 * Follow-up state per lead, keyed by lead id. Reads the RLS-scoped
 * `leads_with_followup` view, so an agent only gets their own leads.
 * Leads that were never emailed are absent from the map.
 */
export async function getFollowUps(
  supabase: SupabaseClient<any, any, any>,
  leadId?: string,
): Promise<Record<string, FollowUpInfo>> {
  let q = supabase.from("leads_with_followup").select(COLUMNS)
  if (leadId) q = q.eq("lead_id", leadId)
  const { data } = await q
  const now = new Date()
  const out: Record<string, FollowUpInfo> = {}
  for (const row of (data ?? []) as FollowUpRow[]) {
    const info = evaluateFollowUp(row, now)
    if (info) out[row.lead_id] = info
  }
  return out
}
