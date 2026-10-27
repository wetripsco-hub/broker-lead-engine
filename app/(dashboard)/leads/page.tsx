import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getFollowUps } from "@/lib/follow-up/query"
import { fetchAll } from "@/lib/supabase/fetch-all"
import { LeadsListClient } from "./leads-list-client"

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>
}) {
  const { filter } = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const isAdmin = user.user_metadata?.role === "admin"

  // Everything the page needs is requested at the same time (one wait instead of eight in a row).
  // Lists are read in pages because the API returns at most 1000 rows per request.
  const [leads, templatesRes, followUpByLead, favRes, myAgentRes, emailEventsRaw, aiEventsRaw, agentsRes] = await Promise.all([
    fetchAll<any>(() =>
      supabase
        .from("leads")
        .select(`
      id,
      stage,
      assigned_agent_id,
      created_at,
      brokers ( mc_number, dot_number, mc_status, company_name, contact_name, city, state, phone, email ),
      agents ( name )
    `)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false }),
    ),
    supabase.from("email_templates").select("id, name, subject, body, type").order("created_at", { ascending: true }),
    getFollowUps(supabase),
    // This user's stars. If the favorites migration hasn't been run the query just errors and the
    // list shows no stars, instead of breaking the page.
    (supabase.from("lead_favorites") as any).select("lead_id"),
    supabase.from("agents").select("name").eq("user_id", user.id).maybeSingle(),
    // Latest email status per lead: newest first, then the first (latest) row per lead is kept below.
    fetchAll<any>(() =>
      supabase
        .from("outreach_events")
        .select("lead_id, status, open_count, click_count, occurred_at")
        .eq("channel", "email")
        .eq("direction", "outbound")
        .order("occurred_at", { ascending: false })
        .order("id", { ascending: false }),
    ),
    // Latest AI call per lead. Tolerant: if the AI-calling columns aren't there the list shows none.
    fetchAll<any>(() =>
      (supabase.from("outreach_events") as any)
        .select("lead_id, status, call_status, disposition, duration_seconds, occurred_at")
        .eq("channel", "ai_call")
        .order("occurred_at", { ascending: false })
        .order("id", { ascending: false }),
    ),
    // Full agent roster for the assignment dropdown + "by agent" filter: admin only.
    isAdmin
      ? supabase.from("agents").select("id, name").eq("active", true).order("name", { ascending: true })
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
  ])

  const templates = (templatesRes.data ?? []) as Array<{
    id: string; name: string; subject: string; body: string; type: "initial" | "follow_up"
  }>
  const favoriteIds = (((favRes as any).data ?? []) as Array<{ lead_id: string }>).map((f) => f.lead_id)
  const currentAgentName = ((myAgentRes.data as { name: string } | null)?.name) ?? ""
  const allAgents = ((agentsRes.data ?? []) as Array<{ id: string; name: string }>)

  const emailStatusByLead: Record<string, { status: string; openCount: number; clickCount: number }> = {}
  for (const e of (emailEventsRaw ?? []) as any[]) {
    if (!e.lead_id || emailStatusByLead[e.lead_id]) continue
    emailStatusByLead[e.lead_id] = { status: e.status, openCount: e.open_count ?? 0, clickCount: e.click_count ?? 0 }
  }

  const aiCallByLead: Record<string, { status: string; callStatus: string | null; disposition: string | null; seconds: number | null; at: string }> = {}
  for (const e of (aiEventsRaw ?? []) as any[]) {
    if (!e.lead_id || aiCallByLead[e.lead_id]) continue
    aiCallByLead[e.lead_id] = {
      status: e.status,
      callStatus: e.call_status ?? null,
      disposition: e.disposition ?? null,
      seconds: e.duration_seconds ?? null,
      at: e.occurred_at,
    }
  }

  return (
    <div className="p-3 sm:p-6 max-w-7xl mx-auto">
      <LeadsListClient
        leads={leads}
        isAdmin={isAdmin}
        templates={templates}
        currentAgentName={currentAgentName}
        emailStatusByLead={emailStatusByLead}
        aiCallByLead={aiCallByLead}
        allAgents={allAgents}
        followUpByLead={followUpByLead}
        favoriteIds={favoriteIds}
        initialFollowUpOnly={filter === "followup"}
      />
    </div>
  )
}
