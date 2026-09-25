"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { sendSms } from "@/lib/telnyx/sms"

async function getCurrentAgent(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" as const }

  const { data: agentRaw } = await (supabase.from("agents") as any)
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle()
  if (!agentRaw) return { error: "No agent record for this user" as const }

  return { agentId: (agentRaw as { id: string }).id }
}

export async function sendInboxSms(
  toNumber: string,
  text: string,
  leadId: string | null,
): Promise<{ error?: string; eventId?: string }> {
  if (!text.trim()) return { error: "Message cannot be empty" }
  if (text.length > 1600) return { error: "Message too long (max 1600 chars)" }

  const supabase = await createClient()
  const agent = await getCurrentAgent(supabase)
  if ("error" in agent) return { error: agent.error }

  let externalId: string | null = null
  try {
    const result = await sendSms(toNumber, text)
    externalId = result.id
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) }
  }

  const { data, error } = await (supabase.from("outreach_events") as any)
    .insert({
      lead_id: leadId,
      agent_id: agent.agentId,
      channel: "sms",
      status: "sent",
      message_body: text,
      direction: "outbound",
      external_id: externalId,
      from_number: process.env.TELNYX_SMS_NUMBER ?? null,
      to_number: toNumber,
    })
    .select("id")
    .single()

  if (error) return { error: error.message }

  revalidatePath("/messages")
  if (leadId) revalidatePath(`/leads/${leadId}`)
  return { eventId: (data as { id: string }).id }
}

export async function markConversationRead(number: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  const { error } = await (supabase.from("outreach_events") as any)
    .update({ read_at: new Date().toISOString() })
    .eq("channel", "sms")
    .eq("direction", "inbound")
    .eq("from_number", number)
    .is("read_at", null)

  if (error) return { error: error.message }
  revalidatePath("/messages")
  return {}
}

// Unknown numbers aren't tied to any broker yet, but every lead needs one
// (brokers.mc_number is required + unique), so we mint a synthetic MC
// number as a placeholder the admin can correct later from the lead page.
//
// brokers can only be written by admins under RLS (they're normally
// FMCSA-sourced), but any agent chatting with an unknown number should be
// able to promote it to a lead — so this specific write goes through the
// admin client after confirming the caller is a logged-in user.
export async function addNumberAsLead(number: string): Promise<{ error?: string; leadId?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  const admin = createAdminClient()
  const digits = number.replace(/\D/g, "")
  const syntheticMc = `SMS-${digits}`

  const { data: existingBroker } = await (admin.from("brokers") as any)
    .select("id")
    .eq("phone", number)
    .maybeSingle()

  let brokerId = (existingBroker as { id: string } | null)?.id ?? null

  if (!brokerId) {
    const { data: newBroker, error: insertError } = await (admin.from("brokers") as any)
      .insert({
        mc_number: syntheticMc,
        company_name: `Unknown (${number})`,
        phone: number,
      })
      .select("id")
      .single()

    if (insertError) return { error: insertError.message }
    brokerId = (newBroker as { id: string }).id
  }

  const { data: leadRow } = await (admin.from("leads") as any)
    .select("id")
    .eq("broker_id", brokerId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  const leadId = (leadRow as { id: string } | null)?.id
  if (!leadId) return { error: "Lead was not auto-created for this broker" }

  // Attach this conversation's history to the new lead.
  await (admin.from("outreach_events") as any)
    .update({ lead_id: leadId })
    .eq("channel", "sms")
    .is("lead_id", null)
    .or(`from_number.eq.${number},to_number.eq.${number}`)

  revalidatePath("/messages")
  revalidatePath("/leads")
  return { leadId }
}
