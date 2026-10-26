"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { sendSms } from "@/lib/telnyx/sms"
import { toE164 } from "@/lib/phone"
import { checkSmsAllowed } from "@/lib/sms-guard"

export async function sendLeadSms(
  leadId: string,
  brokerPhone: string,
  text: string,
): Promise<{ error?: string; eventId?: string }> {
  if (!text.trim()) return { error: "Message cannot be empty" }
  if (text.length > 1600) return { error: "Message too long (max 1600 chars)" }
  // A placeholder like [Name] or [day] still in the text means the script was not filled in.
  if (/\[(Name|First Name|Full Name|day|time|number|Phone)\]/.test(text)) {
    return { error: "The text still has a [placeholder]. Fill it in first." }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  // The number comes from the lead itself, not from the browser, so this cannot be used to text
  // an arbitrary number. (Row-level security: a lead the user cannot see is not found.)
  const { data: leadRow } = await (supabase.from("leads") as any)
    .select("id, brokers ( phone, phone_e164 )")
    .eq("id", leadId)
    .maybeSingle()
  if (!leadRow) return { error: "Lead not found" }
  const to = toE164(leadRow.brokers?.phone_e164) ?? toE164(leadRow.brokers?.phone) ?? toE164(brokerPhone)
  if (!to) return { error: "Invalid phone number" }

  const allowed = await checkSmsAllowed(supabase, user.id, { leadId, to })
  if (!allowed.allowed) return { error: allowed.reason }

  const { data: agentRaw } = await (supabase.from("agents") as any)
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle()

  if (!agentRaw) return { error: "No agent record for this user" }
  const agentId = (agentRaw as { id: string }).id

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
      agent_id: agentId,
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

  revalidatePath(`/leads/${leadId}`)
  return { eventId: (data as { id: string }).id }
}
