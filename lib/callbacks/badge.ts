// "Callback received" on a lead: the broker called us back, the admin hasn't marked it handled,
// and nobody has called the lead since. Read with the signed-in user's client, so RLS limits an
// agent to their own leads. Pure part is exported for the tests.

import type { SupabaseClient } from "@supabase/supabase-js"

export interface OpenCallback {
  at: string
  status: string
}

const LOOKBACK_DAYS = 14

export function openCallbacksFrom(
  callbacks: Array<{ lead_id: string | null; status: string; received_at: string; handled_at: string | null }>,
  lastOutboundCallAt: Record<string, string>,
): Record<string, OpenCallback> {
  const out: Record<string, OpenCallback> = {}
  for (const c of callbacks) {
    if (!c.lead_id || c.handled_at) continue
    const called = lastOutboundCallAt[c.lead_id]
    if (called && Date.parse(called) > Date.parse(c.received_at)) continue // already called back
    const prev = out[c.lead_id]
    if (!prev || Date.parse(c.received_at) > Date.parse(prev.at)) out[c.lead_id] = { at: c.received_at, status: c.status }
  }
  return out
}

export async function getOpenCallbacks(
  supabase: SupabaseClient<any, any, any>,
  leadId?: string,
  now: Date = new Date(),
): Promise<Record<string, OpenCallback>> {
  let q = (supabase.from("callbacks") as any)
    .select("lead_id, status, received_at, handled_at")
    .is("handled_at", null)
    .not("lead_id", "is", null)
    .gte("received_at", new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000).toISOString())
    .order("received_at", { ascending: false })
    .limit(500)
  if (leadId) q = q.eq("lead_id", leadId)
  const { data, error } = await q
  if (error || !data?.length) return {} // table missing or nothing open: no badges, never a broken page
  const rows = data as Array<{ lead_id: string; status: string; received_at: string; handled_at: string | null }>
  const leadIds = [...new Set(rows.map((r) => r.lead_id))]
  const { data: calls } = await (supabase.from("outreach_events") as any)
    .select("lead_id, occurred_at")
    .in("lead_id", leadIds)
    .in("channel", ["call", "ai_call"])
    .eq("direction", "outbound")
    .gte("occurred_at", rows[rows.length - 1].received_at)
    .order("occurred_at", { ascending: false })
    .limit(1000)
  const last: Record<string, string> = {}
  for (const c of (calls ?? []) as Array<{ lead_id: string; occurred_at: string }>) if (!last[c.lead_id]) last[c.lead_id] = c.occurred_at
  return openCallbacksFrom(rows, last)
}
