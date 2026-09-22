import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { SettingsClient } from "./settings-client"
import type { UserRole } from "@/types/database"

export default async function SettingsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const role = (user.user_metadata?.role as UserRole) ?? "agent"
  const isAdmin = role === "admin"

  const { data: myAgentRaw } = await (supabase.from("agents") as any)
    .select("id, name, user_id, commission_rate")
    .eq("user_id", user.id)
    .maybeSingle()

  const myAgent = myAgentRaw as {
    id: string; name: string; user_id: string; commission_rate: number | null
  } | null

  type AgentRow = { id: string; name: string; user_id: string; commission_rate: number | null }
  let allAgents: AgentRow[] | null = null
  if (isAdmin) {
    const { data } = await (supabase.from("agents") as any)
      .select("id, name, user_id, commission_rate")
      .order("name", { ascending: true })
    allAgents = (data ?? []) as AgentRow[]
  }

  return (
    <SettingsClient
      myAgent={myAgent}
      myEmail={user.email ?? ""}
      myRole={role}
      allAgents={allAgents}
    />
  )
}
