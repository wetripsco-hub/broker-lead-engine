"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isAdminInDb } from "@/lib/voice-agents/admin-check"
import { statusAfterReply, validateNewTicket, validateReply, type NewTicketInput } from "@/lib/tickets"

// Who is asking, from the session and the database — never from the browser.
async function whoAmI() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const [isAdmin, { data: agent }] = await Promise.all([
    isAdminInDb(createAdminClient(), user.id),
    (supabase.from("agents") as any).select("id").eq("user_id", user.id).maybeSingle(),
  ])
  return { supabase, userId: user.id, isAdmin, agentId: (agent as { id: string } | null)?.id ?? null }
}

/** The ticket, if this user may see it: the admin sees all, an agent only their own. */
async function loadTicket(ticketId: string, me: NonNullable<Awaited<ReturnType<typeof whoAmI>>>) {
  const { data } = await (createAdminClient().from("support_tickets") as any)
    .select("id, agent_id, status")
    .eq("id", ticketId)
    .maybeSingle()
  const t = data as { id: string; agent_id: string; status: string } | null
  if (!t) return null
  if (!me.isAdmin && t.agent_id !== me.agentId) return null
  return t
}

export async function createTicket(input: NewTicketInput): Promise<{ error?: string; ticketId?: string }> {
  const me = await whoAmI()
  if (!me) return { error: "Not authenticated" }
  if (me.isAdmin) return { error: "Tickets are raised by agents." }
  if (!me.agentId) return { error: "No agent record for this user" }

  const v = validateNewTicket(input)
  if (!v.ok) return { error: v.error }

  // A client ticket must be about one of this agent's own leads.
  if (v.value.leadId) {
    const { data: lead } = await (me.supabase.from("leads") as any)
      .select("id, assigned_agent_id")
      .eq("id", v.value.leadId)
      .maybeSingle()
    if (!lead || lead.assigned_agent_id !== me.agentId) return { error: "This lead is not assigned to you." }
  }

  const admin = createAdminClient() as any
  const now = new Date().toISOString()
  const { data: ticket, error } = await admin
    .from("support_tickets")
    .insert({
      agent_id: me.agentId,
      lead_id: v.value.leadId,
      topic: v.value.topic,
      subject: v.value.subject,
      status: "open",
      created_at: now,
      last_message_at: now,
    })
    .select("id")
    .single()
  if (error) return { error: error.message }
  const ticketId = (ticket as { id: string }).id

  const { error: msgError } = await admin
    .from("ticket_messages")
    .insert({ ticket_id: ticketId, author_id: me.userId, from_admin: false, body: v.value.body, created_at: now })
  if (msgError) {
    await admin.from("support_tickets").delete().eq("id", ticketId)
    return { error: msgError.message }
  }

  revalidatePath("/tickets")
  return { ticketId }
}

export async function replyToTicket(ticketId: string, body: string): Promise<{ error?: string }> {
  const me = await whoAmI()
  if (!me) return { error: "Not authenticated" }
  const v = validateReply(body)
  if (!v.ok) return { error: v.error }
  const ticket = await loadTicket(ticketId, me)
  if (!ticket) return { error: "Ticket not found" }

  const admin = createAdminClient() as any
  const now = new Date().toISOString()
  const { error } = await admin
    .from("ticket_messages")
    .insert({ ticket_id: ticketId, author_id: me.userId, from_admin: me.isAdmin, body: v.body, created_at: now })
  if (error) return { error: error.message }

  await admin
    .from("support_tickets")
    .update({
      status: statusAfterReply(me.isAdmin),
      last_message_at: now,
      closed_at: null,
      // The agent gets a badge when the admin answers.
      agent_unread: me.isAdmin,
    })
    .eq("id", ticketId)

  revalidatePath("/tickets")
  return {}
}

/** Close or reopen. The admin and the agent who raised the ticket may both do this. */
export async function setTicketClosed(ticketId: string, closed: boolean): Promise<{ error?: string }> {
  const me = await whoAmI()
  if (!me) return { error: "Not authenticated" }
  const ticket = await loadTicket(ticketId, me)
  if (!ticket) return { error: "Ticket not found" }

  const { error } = await (createAdminClient().from("support_tickets") as any)
    .update(closed ? { status: "closed", closed_at: new Date().toISOString() } : { status: "open", closed_at: null })
    .eq("id", ticketId)
  if (error) return { error: error.message }
  revalidatePath("/tickets")
  return {}
}
