import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { AgentsClient } from "./agents-client"

export default async function AgentsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")
  // Server-side gate — the sidebar hides this link for agents, but that
  // alone doesn't stop a direct URL visit.
  if (user.user_metadata?.role !== "admin") redirect("/leads")

  const { data: agentsRaw } = await supabase
    .from("agents")
    .select("id, name, email, active, created_at")
    .order("created_at", { ascending: true })
  const agents = (agentsRaw ?? []) as Array<{
    id: string
    name: string
    email: string | null
    active: boolean
    created_at: string
  }>

  const { data: leadCountsRaw } = await supabase
    .from("leads")
    .select("assigned_agent_id")
    .not("assigned_agent_id", "is", null)

  const leadCounts: Record<string, number> = {}
  for (const l of (leadCountsRaw ?? []) as Array<{ assigned_agent_id: string }>) {
    leadCounts[l.assigned_agent_id] = (leadCounts[l.assigned_agent_id] ?? 0) + 1
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <AgentsClient agents={agents} leadCounts={leadCounts} />
    </div>
  )
}
