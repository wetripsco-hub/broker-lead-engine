"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { toE164 } from "@/lib/phone"
import {
  DISPOSITION_LABEL,
  DISPOSITION_STATUS,
  DISPOSITION_STAGE,
  isSmsPermissionOutcome,
} from "@/lib/call-dispositions"
import type { DispositionKey } from "@/lib/call-dispositions"

export type { DispositionKey }

export async function logCallStarted(
  leadId: string,
  agentId: string,
  externalId: string | null,
): Promise<{ error?: string; eventId?: string; blocked?: boolean }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  // Do-not-call blocks calls for everyone. The dialer stops when `blocked` comes back.
  const { data: leadRow } = await (supabase.from("leads") as any)
    .select("do_not_call, brokers ( phone, phone_e164 )")
    .eq("id", leadId)
    .maybeSingle()
  let dnc = leadRow?.do_not_call === true
  if (!dnc) {
    const phone = toE164(leadRow?.brokers?.phone_e164) ?? toE164(leadRow?.brokers?.phone)
    if (phone) {
      const { data: onList } = await (createAdminClient() as any).from("do_not_call_numbers").select("id").eq("phone", phone).maybeSingle()
      dnc = !!onList
    }
  }
  if (dnc) return { error: "This lead is marked do-not-call. Calls are blocked.", blocked: true }

  const { data, error } = await (supabase.from("outreach_events") as any)
    .insert({
      lead_id: leadId,
      agent_id: agentId,
      channel: "call",
      status: "pending",
      direction: "outbound",
      external_id: externalId,
    })
    .select("id")
    .single()

  if (error) return { error: error.message }
  return { eventId: (data as { id: string }).id }
}

// Saved the moment the call ends, so a transcript is never lost if the agent
// closes the dialog before confirming the outcome. RLS limits the update to
// events on leads the agent can see.
export async function saveCallTranscript(
  eventId: string,
  transcript: string,
): Promise<{ error?: string }> {
  const text = transcript.trim()
  if (!text) return {}
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }
  const { error } = await (supabase.from("outreach_events") as any)
    .update({ transcript: text.slice(0, 200_000) })
    .eq("id", eventId)
  return error ? { error: error.message } : {}
}

export async function saveCallDisposition(
  eventId: string,
  leadId: string,
  disposition: DispositionKey,
  notes: string,
  durationSeconds: number,
  extra: { aiSummary?: string | null; followUpDate?: string | null } = {},
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  const label = DISPOSITION_LABEL[disposition]
  const messageBody = [
    `Disposition: ${label}`,
    `Duration: ${durationSeconds}s`,
    notes.trim() ? `Notes: ${notes.trim()}` : null,
    extra.followUpDate ? `Follow up: ${extra.followUpDate}` : null,
  ]
    .filter(Boolean)
    .join("\n")

  const { data: evUpdated, error: evErr } = await (supabase.from("outreach_events") as any)
    .update({
      status: DISPOSITION_STATUS[disposition],
      disposition,
      message_body: messageBody,
      ...(extra.aiSummary ? { ai_summary: extra.aiSummary } : {}),
      ...(extra.followUpDate ? { follow_up_date: extra.followUpDate } : {}),
    })
    .eq("id", eventId)
    .select("id")

  if (evErr) return { error: evErr.message }
  if (!evUpdated || evUpdated.length === 0) return { error: "Call record not found (no permission?)" }

  // Permission to text, given on the call: record the date once (the first permission is the
  // proof). Written with the service role because the database stops agents editing it directly;
  // we only get here for a call event the signed-in user could update.
  if (isSmsPermissionOutcome(disposition)) {
    await (createAdminClient().from("leads") as any)
      .update({
        sms_consent_at: new Date().toISOString(),
        sms_consent_source: `Verbal permission on a call (outcome: ${label}), event ${eventId}`,
      })
      .eq("id", leadId)
      .is("sms_consent_at", null)
  }

  // Do not call: flag the lead and put the number on the global list, so calls and texts stop.
  if (disposition === "do_not_call") {
    await (supabase.from("leads") as any).update({ do_not_call: true }).eq("id", leadId)
    const { data: lead } = await (supabase.from("leads") as any)
      .select("brokers ( phone, phone_e164 )")
      .eq("id", leadId)
      .maybeSingle()
    const phone = toE164(lead?.brokers?.phone_e164) ?? toE164(lead?.brokers?.phone)
    if (phone) {
      await (createAdminClient().from("do_not_call_numbers") as any).upsert(
        { phone, reason: "Asked not to be called (call outcome)" },
        { onConflict: "phone" },
      )
    }
  }

  const newStage = DISPOSITION_STAGE[disposition]
  if (newStage) {
    await (supabase.from("leads") as any)
      .update({ stage: newStage })
      .eq("id", leadId)
      .in("stage", disposition === "do_not_call" ? ["new", "contacted", "interested"] : ["new", "contacted"])
  }

  revalidatePath(`/leads/${leadId}`)
  revalidatePath("/leads")
  return {}
}
