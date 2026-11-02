import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isAdminInDb } from "@/lib/voice-agents/admin-check"
import { fetchAll } from "@/lib/supabase/fetch-all"
import { TicketsClient, type TicketListItem, type TicketMessage, type LeadOption } from "./tickets-client"

// Support tickets. Agents raise them and see their own; the admin sees every
// ticket and answers. RLS decides what each list returns.
export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string; new?: string; lead?: string }>
}) {
  const { t: selectedId, new: isNew, lead: presetLeadId } = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")
  const isAdmin = await isAdminInDb(createAdminClient(), user.id)

  const { data: ticketsRaw } = await (supabase.from("support_tickets") as any)
    .select("id, topic, subject, status, agent_unread, created_at, last_message_at, agents ( name ), leads ( id, brokers ( company_name, mc_number ) )")
    .order("last_message_at", { ascending: false })
    .limit(300)

  const tickets: TicketListItem[] = ((ticketsRaw ?? []) as any[]).map((t) => ({
    id: t.id,
    topic: t.topic,
    subject: t.subject,
    status: t.status,
    agentUnread: t.agent_unread === true,
    createdAt: t.created_at,
    lastMessageAt: t.last_message_at,
    agentName: t.agents?.name ?? "Unknown agent",
    leadId: t.leads?.id ?? null,
    leadLabel: t.leads?.brokers
      ? `${t.leads.brokers.company_name ?? "Unknown broker"}${t.leads.brokers.mc_number ? ` · MC-${t.leads.brokers.mc_number}` : ""}`
      : null,
  }))

  const selected = selectedId ? (tickets.find((t) => t.id === selectedId) ?? null) : null
  let messages: TicketMessage[] = []
  if (selected) {
    const { data: msgRaw } = await (supabase.from("ticket_messages") as any)
      .select("id, from_admin, body, created_at")
      .eq("ticket_id", selected.id)
      .order("created_at", { ascending: true })
    messages = ((msgRaw ?? []) as any[]).map((m) => ({ id: m.id, fromAdmin: m.from_admin, body: m.body, createdAt: m.created_at }))
    // The agent has now seen the admin's answer: clear their badge.
    if (!isAdmin && selected.agentUnread) {
      await (createAdminClient().from("support_tickets") as any).update({ agent_unread: false }).eq("id", selected.id)
      selected.agentUnread = false
    }
  }

  // Agents pick which of their own leads a client ticket is about (company + MC only).
  let leads: LeadOption[] = []
  if (!isAdmin && isNew) {
    const rows = await fetchAll<any>(() =>
      (supabase.from("leads") as any)
        .select("id, brokers ( company_name, mc_number )")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false }),
    )
    leads = rows.map((l) => ({
      id: l.id,
      label: `${l.brokers?.company_name ?? "Unknown broker"}${l.brokers?.mc_number ? ` · MC-${l.brokers.mc_number}` : ""}`,
    }))
  }

  return (
    <div className="h-[calc(100vh-3rem)]">
      <TicketsClient
        isAdmin={isAdmin}
        tickets={tickets}
        selected={selected}
        messages={messages}
        showNew={!isAdmin && !!isNew}
        leads={leads}
        presetLeadId={presetLeadId ?? null}
      />
    </div>
  )
}
