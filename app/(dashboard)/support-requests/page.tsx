import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isAdminInDb } from "@/lib/voice-agents/admin-check"
import { SupportRequestsClient, type SupportRequestRow } from "./support-requests-client"

// Admin only: "Contact Support" requests sent from the login screen.
export default async function SupportRequestsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")
  const admin = createAdminClient()
  if (!(await isAdminInDb(admin, user.id))) redirect("/leads")

  const { data } = await (admin.from("support_requests") as any)
    .select("id, login_id, agent_id, message, status, created_at, resolved_at, agents ( name )")
    .order("status", { ascending: true }) // "open" sorts before "resolved"
    .order("created_at", { ascending: false })
    .limit(200)

  const rows: SupportRequestRow[] = ((data ?? []) as any[]).map((r) => ({
    id: r.id,
    loginId: r.login_id,
    agentName: r.agents?.name ?? null,
    message: r.message,
    status: r.status,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
  }))

  return (
    <div className="p-3 sm:p-6 max-w-4xl mx-auto">
      <SupportRequestsClient rows={rows} />
    </div>
  )
}
