import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getFollowUps } from "@/lib/follow-up/query"
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

  const { data } = await supabase
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

  const leads = (data ?? []) as any[]

  const { data: templatesRaw } = await supabase
    .from("email_templates")
    .select("id, name, subject, body, type")
    .order("created_at", { ascending: true })
  const templates = (templatesRaw ?? []) as Array<{
    id: string; name: string; subject: string; body: string; type: "initial" | "follow_up"
  }>

  const followUpByLead = await getFollowUps(supabase)

  const { data: myAgentRaw } = await supabase
    .from("agents")
    .select("name")
    .eq("user_id", user.id)
    .maybeSingle()
  const currentAgentName = (myAgentRaw as { name: string } | null)?.name ?? ""

  // Latest email status per lead, for the "Email Status" column — one query
  // for all leads, newest first, then keep only the first (latest) row per
  // lead_id client-side (Postgres has no simple "latest per group" select).
  const { data: emailEventsRaw } = await supabase
    .from("outreach_events")
    .select("lead_id, status, open_count, click_count, occurred_at")
    .eq("channel", "email")
    .eq("direction", "outbound")
    .order("occurred_at", { ascending: false })

  const emailStatusByLead: Record<string, { status: string; openCount: number; clickCount: number }> = {}
  for (const e of (emailEventsRaw ?? []) as any[]) {
    if (!e.lead_id || emailStatusByLead[e.lead_id]) continue
    emailStatusByLead[e.lead_id] = { status: e.status, openCount: e.open_count ?? 0, clickCount: e.click_count ?? 0 }
  }

  // Full agent roster for the assignment dropdown + "by agent" filter — admin only
  let allAgents: Array<{ id: string; name: string }> = []
  if (isAdmin) {
    const { data: agentsRaw } = await supabase
      .from("agents")
      .select("id, name")
      .eq("active", true)
      .order("name", { ascending: true })
    allAgents = (agentsRaw ?? []) as Array<{ id: string; name: string }>
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <LeadsListClient
        leads={leads}
        isAdmin={isAdmin}
        templates={templates}
        currentAgentName={currentAgentName}
        emailStatusByLead={emailStatusByLead}
        allAgents={allAgents}
        followUpByLead={followUpByLead}
        initialFollowUpOnly={filter === "followup"}
      />
    </div>
  )
}
