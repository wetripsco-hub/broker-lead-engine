"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { toE164 } from "@/lib/phone"
import { isAdminInDb } from "@/lib/voice-agents/admin-check"
import { checkCallingWindow } from "@/lib/timezone/calling-window"
import { checkCallCooldown } from "@/lib/call-cooldown-guard"
import {
  activeGrant,
  checkHourlyLimit,
  consumeGrant,
  getAgentCallState,
  latestAfterHoursRequest,
  type AgentCallState,
} from "@/lib/agent-call-rules"
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
    .select("do_not_call, brokers ( phone, phone_e164, state )")
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

  // Agents only (the admin is never limited): calling hours, hourly limit,
  // broker cooldown. The role comes from the database, never from the browser.
  let grantId: string | null = null
  let callerAgentId = agentId
  if (!(await isAdminInDb(createAdminClient(), user.id))) {
    if (!leadRow) return { error: "Lead not found", blocked: true }
    const { data: me } = await (supabase.from("agents") as any).select("id").eq("user_id", user.id).maybeSingle()
    if (!me) return { error: "No agent record for this user", blocked: true }
    // The call is logged under the signed-in agent, whatever id the browser sent.
    callerAgentId = (me as { id: string }).id
    const now = new Date()

    const w = checkCallingWindow(leadRow.brokers?.state ?? null, leadRow.brokers?.phone ?? null, now)
    if (!w.inside) {
      const grant = await activeGrant(callerAgentId, leadId, now)
      if (!grant) return { error: "Outside calling hours. Send an after-hours request to the admin.", blocked: true }
      grantId = grant.id
    }
    // Either of these blocks the call without using up the grant.
    const [hourly, cooldown] = await Promise.all([checkHourlyLimit(callerAgentId, now), checkCallCooldown(leadId, now)])
    if (hourly.blocked) return { error: hourly.message ?? "Hourly call limit reached.", blocked: true }
    if (cooldown.blocked) return { error: cooldown.message ?? "This broker is in cooldown.", blocked: true }
  }

  const { data, error } = await (supabase.from("outreach_events") as any)
    .insert({
      lead_id: leadId,
      agent_id: callerAgentId,
      channel: "call",
      status: "pending",
      direction: "outbound",
      external_id: externalId,
    })
    .select("id")
    .single()

  if (error) return { error: error.message }
  const eventId = (data as { id: string }).id

  // One grant = one call. If another call used it a moment ago, this one stops.
  if (grantId && !(await consumeGrant(grantId, eventId))) {
    await (createAdminClient().from("outreach_events") as any).delete().eq("id", eventId)
    return { error: "This after-hours approval was already used or has expired. Send a new request.", blocked: true }
  }
  return { eventId }
}

// ─── Agent call state (calling hours, after-hours request, limits) ─────────

/**
 * What the agent's Call button shows. `null` for the admin, who has none of
 * these rules. Read through the user's session first, so an agent only gets
 * state for leads RLS lets them see.
 */
export async function getMyCallState(leadId: string): Promise<{ state: AgentCallState | null; error?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { state: null, error: "Not authenticated" }
  if (await isAdminInDb(createAdminClient(), user.id)) return { state: null }

  const [{ data: leadRow }, { data: me }] = await Promise.all([
    (supabase.from("leads") as any).select("id, brokers ( state, phone )").eq("id", leadId).maybeSingle(),
    (supabase.from("agents") as any).select("id").eq("user_id", user.id).maybeSingle(),
  ])
  if (!leadRow) return { state: null, error: "Lead not found" }
  if (!me) return { state: null, error: "No agent record for this user" }
  const state = await getAgentCallState((me as { id: string }).id, leadId, {
    state: leadRow.brokers?.state ?? null,
    phone: leadRow.brokers?.phone ?? null,
  })
  return { state }
}

/** Agent asks the admin to allow one call outside calling hours. */
export async function requestAfterHoursCall(leadId: string, note: string): Promise<{ error?: string }> {
  const text = note.trim()
  if (!text) return { error: "Please write why you need to call now." }
  if (text.length > 1000) return { error: "Note is too long (max 1000 characters)." }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }
  if (await isAdminInDb(createAdminClient(), user.id)) return { error: "Admins don't need an after-hours request." }

  const [{ data: leadRow }, { data: me }] = await Promise.all([
    (supabase.from("leads") as any).select("id, assigned_agent_id").eq("id", leadId).maybeSingle(),
    (supabase.from("agents") as any).select("id").eq("user_id", user.id).maybeSingle(),
  ])
  if (!me) return { error: "No agent record for this user" }
  const myId = (me as { id: string }).id
  if (!leadRow || leadRow.assigned_agent_id !== myId) return { error: "This lead is not assigned to you." }

  const latest = await latestAfterHoursRequest(myId, leadId)
  if (latest?.status === "pending") return { error: "A request for this lead is already waiting for the admin." }
  if (latest?.status === "granted") return { error: "You already have an approval for this lead — call now." }

  // Through the agent's own session: RLS allows only their own pending rows.
  const { error } = await (supabase.from("after_hours_requests") as any).insert({
    agent_id: myId,
    lead_id: leadId,
    note: text,
    status: "pending",
  })
  if (error) {
    if ((error as { code?: string }).code === "23505") return { error: "A request for this lead is already waiting for the admin." }
    return { error: error.message }
  }
  revalidatePath("/requests")
  return {}
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
