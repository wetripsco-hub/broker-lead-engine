import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { LeadsListClient } from "./leads-list-client"

export default async function LeadsPage() {
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
      brokers ( mc_number, company_name, contact_name, city, state, phone, email ),
      agents ( name )
    `)
    .order("created_at", { ascending: false })

  const leads = (data ?? []) as any[]

  const { data: templatesRaw } = await supabase
    .from("email_templates")
    .select("id, name, subject, body")
    .order("created_at", { ascending: true })
  const templates = (templatesRaw ?? []) as Array<{
    id: string; name: string; subject: string; body: string
  }>

  const { data: myAgentRaw } = await supabase
    .from("agents")
    .select("name")
    .eq("user_id", user.id)
    .maybeSingle()
  const currentAgentName = (myAgentRaw as { name: string } | null)?.name ?? ""

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <LeadsListClient
        leads={leads}
        isAdmin={isAdmin}
        templates={templates}
        currentAgentName={currentAgentName}
      />
    </div>
  )
}
