import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isAdminInDb } from "@/lib/voice-agents/admin-check"
import { expireOldGrants } from "@/lib/agent-call-rules"
import { resolveTimezone } from "@/lib/timezone/broker-time"
import { RequestsClient, type RequestRow } from "./requests-client"

const SELECT = `
  id, status, note, deny_reason, requested_at, decided_at, expires_at, used_at,
  agents ( name ),
  leads ( id, brokers ( company_name, mc_number, state, phone ) )
`

// Admin only: after-hours call requests from agents.
export default async function RequestsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")
  const admin = createAdminClient()
  if (!(await isAdminInDb(admin, user.id))) redirect("/leads")

  await expireOldGrants()
  const [{ data: pendingRaw }, { data: decidedRaw }] = await Promise.all([
    (admin.from("after_hours_requests") as any).select(SELECT).eq("status", "pending").order("requested_at", { ascending: true }),
    (admin.from("after_hours_requests") as any).select(SELECT).neq("status", "pending").order("requested_at", { ascending: false }).limit(50),
  ])

  const toRow = (r: any): RequestRow => {
    const b = r.leads?.brokers
    return {
      id: r.id,
      status: r.status,
      note: r.note,
      denyReason: r.deny_reason,
      requestedAt: r.requested_at,
      decidedAt: r.decided_at,
      expiresAt: r.expires_at,
      usedAt: r.used_at,
      agentName: r.agents?.name ?? "Unknown agent",
      leadId: r.leads?.id ?? null,
      companyName: b?.company_name ?? "Unknown broker",
      mcNumber: b?.mc_number ?? null,
      brokerTz: resolveTimezone(b?.state ?? null, b?.phone ?? null)?.tz ?? null,
    }
  }

  return (
    <div className="p-3 sm:p-6 max-w-4xl mx-auto">
      <RequestsClient pending={(pendingRaw ?? []).map(toRow)} decided={(decidedRaw ?? []).map(toRow)} />
    </div>
  )
}
