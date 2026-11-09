// Server-side reads of agent terms. Admin reads go through RLS (admin-only tables);
// an agent only ever gets their own levels via my_agent_terms() (no salary rule, no notes).

import { LAUNCH_OFFER, parseLevels, termsFromRow, type AgentFacingTerms, type AgentTerms } from "@/lib/agent-terms"

type Db = { from: (t: string) => any; rpc: (fn: string, args?: any) => any }

/** The signed-in agent's own terms. Falls back to the Launch offer if none are stored yet. */
export async function loadMyTerms(supabase: Db): Promise<AgentFacingTerms> {
  try {
    const { data, error } = await supabase.rpc("my_agent_terms")
    if (error || !data) return { levels: LAUNCH_OFFER.levels, offer_label: LAUNCH_OFFER.offer_label, effective_date: null }
    return {
      levels: parseLevels((data as any).levels),
      offer_label: (data as any).offer_label ?? null,
      effective_date: (data as any).effective_date ?? null,
    }
  } catch {
    return { levels: LAUNCH_OFFER.levels, offer_label: LAUNCH_OFFER.offer_label, effective_date: null }
  }
}

/** Admin: every agent's terms keyed by agent id (missing table/rows → empty map). */
export async function loadAllTerms(db: Db): Promise<Map<string, AgentTerms>> {
  const out = new Map<string, AgentTerms>()
  const { data } = await db.from("agent_terms").select("*")
  for (const row of (data ?? []) as any[]) out.set(row.agent_id, termsFromRow(row))
  return out
}

/** Admin: one agent's terms (Launch offer if none stored). */
export async function loadAgentTerms(db: Db, agentId: string): Promise<AgentTerms> {
  const { data } = await db.from("agent_terms").select("*").eq("agent_id", agentId).maybeSingle()
  return termsFromRow(data)
}

/** Admin: the default template (Launch offer if none stored). */
export async function loadDefaultTemplate(db: Db): Promise<AgentTerms & { id: string | null; name: string }> {
  const { data } = await db.from("commission_templates").select("*").eq("is_default", true).maybeSingle()
  return { ...termsFromRow(data), id: data?.id ?? null, name: data?.name ?? "Launch offer" }
}
