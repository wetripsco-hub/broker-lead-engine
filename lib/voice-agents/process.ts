import type { SupabaseClient } from "@supabase/supabase-js"
import type { NormalizedVoiceEvent } from "./provider"
import { toE164 } from "@/lib/phone"

type Db = SupabaseClient<any, any, any>

// call_status only moves forward, so a late/duplicate webhook can't undo it.
const RANK: Record<string, number> = { queued: 0, registered: 1, in_progress: 2, ended: 3 }
const rank = (s: string | null | undefined) => (s && s in RANK ? RANK[s] : -1)

interface EventRow {
  id: string
  lead_id: string | null
  call_status: string | null
}

/** Best-effort "March 3" / "tomorrow 2pm" -> YYYY-MM-DD; null when it isn't a clear date. */
function parseSuggestedDate(raw: string, now: Date): string | null {
  const text = raw.trim().toLowerCase()
  if (/\btomorrow\b/.test(text)) return new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10)
  if (/^today\b/.test(text)) return now.toISOString().slice(0, 10)
  const t = Date.parse(raw)
  if (Number.isNaN(t)) return null
  const d = new Date(t)
  return d.getTime() >= now.getTime() - 86_400_000 ? d.toISOString().slice(0, 10) : null
}

/**
 * Applies one provider webhook event. Idempotent: the row is keyed by
 * provider_call_id, every handler only writes the fields its event carries,
 * and call_status never regresses — so the same delivery twice (Retell
 * retries) or out-of-order deliveries end in the same state, one row.
 * Throws on database errors so the provider retries.
 */
export async function processVoiceEvent(
  db: Db,
  providerName: string,
  ev: NormalizedVoiceEvent,
  now = new Date(),
): Promise<{ outcome: "updated" | "created" | "ignored"; eventId?: string }> {
  const meta = ev.metadata

  // 1) Find our row: by provider call id, else by the id we put in metadata
  //    (the webhook can beat the start route writing provider_call_id).
  let row: EventRow | null = null
  const byCall = await db
    .from("outreach_events")
    .select("id, lead_id, call_status")
    .eq("provider_call_id", ev.providerCallId)
    .maybeSingle()
  if (byCall.error) throw new Error(byCall.error.message)
  row = byCall.data as EventRow | null

  if (!row && meta.outreach_event_id) {
    const byId = await db
      .from("outreach_events")
      .select("id, lead_id, call_status")
      .eq("id", meta.outreach_event_id)
      .maybeSingle()
    if (byId.error) throw new Error(byId.error.message)
    row = byId.data as EventRow | null
  }

  // 2) Build the patch for this event type.
  const patch: Record<string, unknown> = { provider: providerName, provider_call_id: ev.providerCallId }
  const advance = (status: string) => {
    if (rank(status) > rank(row?.call_status)) patch.call_status = status
  }

  if (ev.type === "started") advance("in_progress")

  if (ev.type === "ended") {
    advance("ended")
    if (ev.durationSeconds !== undefined) patch.duration_seconds = ev.durationSeconds
    if (ev.transcript) patch.transcript = ev.transcript
    if (ev.recordingUrl) patch.recording_url = ev.recordingUrl
    if (ev.costUsd != null) patch.cost_usd = ev.costUsd
    const unanswered = /no[_-]?answer|did-not-answer|voicemail|dial_|busy|failed|invalid|rejected|did-not-receive|silence|timed-out|error/i.test(ev.disconnectionReason ?? "")
    // "did-not-receive-customer-audio" etc.: the line connected but the person never spoke
    // and the AI never said a word, so it must not show as an answered call.
    patch.status = unanswered || !ev.durationSeconds ? "no_answer" : "answered"
  }

  if (ev.type === "analyzed") {
    advance("ended")
    if (ev.summary) patch.ai_summary = ev.summary
    if (ev.sentiment) patch.sentiment = ev.sentiment
    if (ev.transcript) patch.transcript = ev.transcript
    if (ev.recordingUrl) patch.recording_url = ev.recordingUrl
    if (ev.extracted) patch.ai_extracted = ev.extracted
    patch.disposition = ev.doNotCall
      ? "do_not_call"
      : ev.interested === true
        ? "answered_interested"
        : ev.interested === false
          ? "answered_not_interested"
          : null
    if (ev.callbackTime) {
      patch.ai_callback_time = ev.callbackTime
      // A suggestion only: it lands on the timeline for the agent to act on.
      // Stage is never changed from here.
      const d = parseSuggestedDate(ev.callbackTime, now)
      if (d) patch.follow_up_date = d
    }
  }

  // 3) Write.
  let eventId = row?.id
  let outcome: "updated" | "created" | "ignored" = "updated"
  if (row) {
    const { error } = await db.from("outreach_events").update(patch).eq("id", row.id)
    if (error) throw new Error(error.message)
  } else if (meta.lead_id && meta.agent_id) {
    // Unknown call id but we know who it belongs to: upsert so a duplicate
    // delivery lands on the same row.
    const insert = {
      ...patch,
      lead_id: meta.lead_id,
      agent_id: meta.agent_id,
      channel: "ai_call",
      direction: "outbound",
      call_status: patch.call_status ?? "in_progress",
      status: patch.status ?? "pending",
    }
    const { data, error } = await db
      .from("outreach_events")
      .upsert(insert, { onConflict: "provider_call_id" })
      .select("id")
      .single()
    if (error) throw new Error(error.message)
    eventId = (data as { id: string }).id
    outcome = "created"
  } else {
    return { outcome: "ignored" }
  }

  // 4) Do-not-call: lead flag + the global number list. Never reversed here.
  if (ev.type === "analyzed" && ev.doNotCall) {
    const leadId = row?.lead_id ?? meta.lead_id
    let phone = toE164(ev.toNumber)
    if (leadId) {
      const { error } = await db.from("leads").update({ do_not_call: true }).eq("id", leadId)
      if (error) throw new Error(error.message)
      if (!phone) {
        const { data } = await db.from("leads").select("brokers ( phone )").eq("id", leadId).maybeSingle()
        phone = toE164((data as { brokers?: { phone?: string | null } | null } | null)?.brokers?.phone)
      }
    }
    if (phone) {
      const { error } = await db
        .from("do_not_call_numbers")
        .upsert({ phone, reason: "Asked not to be called on an AI call" }, { onConflict: "phone", ignoreDuplicates: true })
      if (error) throw new Error(error.message)
    }
  }

  return { outcome, eventId }
}
