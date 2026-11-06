import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { daysBetween, OVERDUE_DAYS, toCents, todayIn } from "@/lib/commission"
import { CustomersClient, type CustomerView } from "./customers-client"

// Admin only: paying customers per agent, payments received, cancel.
export default async function CustomersPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")
  if (user.user_metadata?.role !== "admin") redirect("/dashboard")

  const [{ data: customersRaw }, { data: paymentsRaw }, { data: agentsRaw }] = await Promise.all([
    (supabase.from("customers") as any).select("*").order("created_at", { ascending: false }),
    (supabase.from("customer_payments") as any).select("id, customer_id, received_at, amount_usd"),
    (supabase.from("agents") as any).select("*").order("name", { ascending: true }),
  ])

  const agents = ((agentsRaw ?? []) as any[]).map((a) => ({
    id: a.id as string,
    name: a.name as string,
    active: (a.active ?? true) as boolean,
    deleted: !!a.deleted_at,
  }))
  const agentName = new Map(agents.map((a) => [a.id, a.name]))

  const payments = (paymentsRaw ?? []) as Array<{ customer_id: string; received_at: string; amount_usd: string | number }>
  const today = todayIn()

  const customers: CustomerView[] = ((customersRaw ?? []) as any[]).map((c) => {
    const mine = payments.filter((p) => p.customer_id === c.id)
    const last = mine.reduce<string | null>((max, p) => (!max || p.received_at > max ? p.received_at : max), null)
    const overdue =
      c.status === "active" && c.billing === "monthly" && daysBetween(last ?? c.started_at, today) > OVERDUE_DAYS
    return {
      id: c.id,
      agentId: c.agent_id,
      agentName: agentName.get(c.agent_id) ?? "—",
      leadId: c.lead_id ?? null,
      company: c.company_name,
      plan: c.plan,
      billing: c.billing,
      status: c.status,
      startedAt: c.started_at,
      cancelledAt: c.cancelled_at ?? null,
      lastPayment: last,
      totalCents: mine.reduce((s, p) => s + toCents(p.amount_usd), 0),
      overdue,
    }
  })

  return (
    <div className="p-3 sm:p-6 max-w-6xl mx-auto">
      <CustomersClient
        customers={customers}
        agents={agents.filter((a) => !a.deleted)}
        today={today}
      />
    </div>
  )
}
