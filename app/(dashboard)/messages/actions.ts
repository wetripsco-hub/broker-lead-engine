"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { sendSms } from "@/lib/telnyx/sms"
import { toE164, phoneDigits } from "@/lib/phone"
import { checkSmsAllowed } from "@/lib/sms-guard"
import { RULES, TOO_MANY, actionOverLimit } from "@/lib/rate-limit"
import { isAdminInDb } from "@/lib/voice-agents/admin-check"
import { SMS_INBOX_SELECT, maskSmsEventsForAgent } from "./mask-events"

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

  // Same permission rules as the lead page: do-not-call blocks all; admins may text anyone;
  // agents only leads with SMS permission recorded, or people who texted us first.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }
  if (await actionOverLimit(RULES.sms)) return { error: TOO_MANY }

  // Agents only see masked numbers, so for them the number always comes from
  // their lead in the database (RLS: a lead they can't see is not found).
  let to: string | null
  if (await isAdminInDb(createAdminClient(), user.id)) {
    to = toE164(toNumber)
  } else {
    if (!leadId) return { error: "Lead not found" }
    const { data: leadRow } = await (supabase.from("leads") as any)
      .select("id, brokers ( phone, phone_e164 )")
      .eq("id", leadId)
      .maybeSingle()
    if (!leadRow) return { error: "Lead not found" }
    to = toE164(leadRow.brokers?.phone_e164) ?? toE164(leadRow.brokers?.phone)
  }
  if (!to) return { error: "Invalid phone number" }
  const allowed = await checkSmsAllowed(supabase, user.id, { leadId, to })
  if (!allowed.allowed) return { error: allowed.reason }

  let externalId: string | null = null
  try {
    const result = await sendSms(to, text)
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
      from_number: toE164(process.env.TELNYX_SMS_NUMBER) ?? null,
      to_number: to,
    })
    .select("id")
    .single()

  if (error) return { error: error.message }

  revalidatePath("/messages")
  if (leadId) revalidatePath(`/leads/${leadId}`)
  return { eventId: (data as { id: string }).id }
}

export async function markConversationRead(rawNumber: string): Promise<{ error?: string }> {
  const number = toE164(rawNumber) ?? rawNumber // unparsable senders (short codes) stay as-is
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  // Agents' conversations are keyed by lead ("lead:<id>"), not by number.
  if (rawNumber.startsWith("lead:")) {
    const { error } = await (supabase.from("outreach_events") as any)
      .update({ read_at: new Date().toISOString() })
      .eq("channel", "sms")
      .eq("direction", "inbound")
      .eq("lead_id", rawNumber.slice(5))
      .is("read_at", null)
    if (error) return { error: error.message }
    revalidatePath("/messages")
    return {}
  }

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
export async function addNumberAsLead(rawNumber: string): Promise<{ error?: string; leadId?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  const number = toE164(rawNumber)
  if (!number) return { error: "Invalid phone number" }

  const admin = createAdminClient()
  const syntheticMc = `SMS-${phoneDigits(number)}`

  // Duplicate detection is on the normalised number, so "(214) 370-8737",
  // "214.370.8737" and "+12143708737" are all the same broker.
  const { data: existingBroker } = await (admin.from("brokers") as any)
    .select("id")
    .eq("phone_e164", number)
    .limit(1)
    .maybeSingle()

  let brokerId = (existingBroker as { id: string } | null)?.id ?? null

  if (!brokerId) {
    const { data: newBroker, error: insertError } = await (admin.from("brokers") as any)
      .insert({
        mc_number: syntheticMc,
        company_name: `Unknown (${number})`,
        phone: number,
        phone_e164: number,
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

/** The agent's SMS inbox, masked on the server (used for live refresh). */
export async function fetchAgentSmsInbox(): Promise<{ events: any[] }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { events: [] }
  const { data } = await (supabase.from("outreach_events") as any)
    .select(SMS_INBOX_SELECT)
    .eq("channel", "sms")
    .order("occurred_at", { ascending: true })
  return { events: maskSmsEventsForAgent((data ?? []) as any[]) }
}
