"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { sendSms } from "@/lib/telnyx/sms"

export async function sendLeadSms(
  leadId: string,
  brokerPhone: string,
  text: string,
): Promise<{ error?: string; eventId?: string }> {
  if (!text.trim()) return { error: "Message cannot be empty" }
  if (text.length > 1600) return { error: "Message too long (max 1600 chars)" }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  const { data: agentRaw } = await (supabase.from("agents") as any)
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle()

  if (!agentRaw) return { error: "No agent record for this user" }
  const agentId = (agentRaw as { id: string }).id

  let externalId: string | null = null
  try {
    const result = await sendSms(brokerPhone, text)
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
      from_number: process.env.TELNYX_SMS_NUMBER ?? null,
      to_number: brokerPhone,
    })
    .select("id")
    .single()

  if (error) return { error: error.message }

  revalidatePath(`/leads/${leadId}`)
  return { eventId: (data as { id: string }).id }
}
