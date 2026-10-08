import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { loadKnowledge } from "@/lib/copilot/kb"
import { evaluateAiCallGate } from "@/lib/voice-agents/gate"
import { isAdminInDb } from "@/lib/voice-agents/admin-check"
import { spokenRepName } from "@/lib/voice-agents/names"
import { formatLocalTime, resolveTimezone } from "@/lib/timezone/broker-time"
import { toE164 } from "@/lib/phone"
import { getVoiceProvider } from "@/lib/voice-agents"
import { loadAiCallSettings } from "@/lib/voice-agents/settings"

const ACTIVE_STATUSES = ["queued", "registered", "in_progress"]
const STALE_ACTIVE_MS = 30 * 60_000 // a call "active" for 30+ min is treated as stuck, not blocking
const KB_MAX_CHARS = 12_000

const fail = (status: number, error: string, code?: string) =>
  NextResponse.json({ error, code }, { status })

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail(401, "Not signed in")

  let leadId: string | undefined
  let hoursOverrideRequested = false
  try {
    const body = (await request.json()) as { leadId?: string; hoursOverride?: unknown }
    leadId = body.leadId
    hoursOverrideRequested = body.hoursOverride === true
  } catch {
    return fail(400, "Invalid request")
  }
  if (!leadId) return fail(400, "leadId is required")

  const { data: agentRaw } = await (supabase.from("agents") as any)
    .select("id, name")
    .eq("user_id", user.id)
    .maybeSingle()
  const agent = agentRaw as { id: string; name: string } | null
  if (!agent) return fail(403, "No agent record for this user")

  // Read through the user's own session: RLS means an agent only gets leads
  // assigned to them, so someone else's lead looks like "not found".
  const { data: leadRaw } = await (supabase.from("leads") as any)
    .select(
      `id, ai_call_consent, do_not_call,
       brokers ( company_name, contact_name, state, phone, phone_e164, mc_status )`,
    )
    .eq("id", leadId)
    .maybeSingle()
  const lead = leadRaw as {
    id: string
    ai_call_consent: boolean
    do_not_call: boolean
    brokers: {
      company_name: string | null
      contact_name: string | null
      state: string | null
      phone: string | null
      phone_e164: string | null
      mc_status: string | null
    } | null
  } | null
  if (!lead?.brokers) return fail(404, "Lead not found")

  const provider = getVoiceProvider()
  if (!provider.configured()) {
    return fail(503, "AI calling isn't configured on the server yet.", "not_configured")
  }
  const from = provider.fromNumber()

  const admin = createAdminClient()
  // The stored E.164 when present; otherwise computed from the raw phone.
  const to = lead.brokers.phone_e164 ?? toE164(lead.brokers.phone)
  const now = new Date()

  const [settings, dnc, active, recent] = await Promise.all([
    loadAiCallSettings(admin),
    to
      ? (admin.from("do_not_call_numbers") as any).select("id").eq("phone", to).maybeSingle()
      : Promise.resolve({ data: null }),
    (admin.from("outreach_events") as any)
      .select("id")
      .eq("lead_id", lead.id)
      .eq("channel", "ai_call")
      .in("call_status", ACTIVE_STATUSES)
      .gte("occurred_at", new Date(now.getTime() - STALE_ACTIVE_MS).toISOString())
      .limit(1),
    (admin.from("outreach_events") as any)
      .select("id", { count: "exact", head: true })
      .eq("channel", "ai_call")
      .gte("occurred_at", new Date(now.getTime() - 24 * 3600_000).toISOString()),
  ])

  // Only looked up when an override is actually requested. The answer comes
  // from the database, not from the request or the session token.
  const isAdmin = hoursOverrideRequested ? await isAdminInDb(admin, user.id) : false

  const gate = evaluateAiCallGate({
    settings,
    lead: {
      aiCallConsent: lead.ai_call_consent,
      doNotCall: lead.do_not_call,
      state: lead.brokers.state,
      phone: lead.brokers.phone,
    },
    to,
    onDncList: !!(dnc as { data: unknown }).data,
    hasActiveCall: ((active as { data: unknown[] | null }).data ?? []).length > 0,
    callsInLast24h: (recent as { count: number | null }).count ?? 0,
    now,
    hoursOverride: { requested: hoursOverrideRequested, isAdmin },
  })
  if (!gate.ok) return fail(gate.code.startsWith("override_") ? 403 : 409, gate.message, gate.code)

  // Audit trail whenever calling hours were skipped: who, which lead, when,
  // and what time it was for the broker.
  const tzInfo = resolveTimezone(lead.brokers.state, lead.brokers.phone)
  const audit = gate.hoursExemption
    ? {
        hours_exemption: gate.hoursExemption,
        hours_override: gate.hoursExemption === "admin_override",
        broker_local_time: tzInfo ? formatLocalTime(tzInfo.tz, now) : null,
      }
    : {}

  // Relevant slice of the knowledge base for the prompt (strings only).
  const kb = await loadKnowledge(
    supabase,
    "rate confirmation software pricing demo onboarding integrations how it works",
  )
  const b = lead.brokers
  const variables: Record<string, string> = {
    contact_name: b.contact_name ?? "there",
    company_name: b.company_name ?? "your company",
    state: b.state ?? "",
    mc_status: b.mc_status ?? "",
    agent_name: spokenRepName(agent.name),
    knowledge_base: kb.empty ? "(no knowledge base entries yet)" : kb.text.slice(0, KB_MAX_CHARS),
  }

  // Row first, 'queued', so the webhook always has something to land on.
  const { data: rowRaw, error: insertErr } = await (supabase.from("outreach_events") as any)
    .insert({
      lead_id: lead.id,
      agent_id: agent.id,
      channel: "ai_call",
      direction: "outbound",
      status: "pending",
      call_status: "queued",
      provider: provider.id,
      ...audit, // only present when hours were skipped, so normal calls don't depend on these columns
    })
    .select("id")
    .single()
  if (insertErr || !rowRaw) return fail(500, "Couldn't record the call. Nothing was dialled.")
  const eventId = (rowRaw as { id: string }).id

  // Two near-simultaneous clicks can both pass the check above; if another
  // active row now exists for this lead, back out of the newer one.
  const { data: dupes } = await (admin.from("outreach_events") as any)
    .select("id")
    .eq("lead_id", lead.id)
    .eq("channel", "ai_call")
    .in("call_status", ACTIVE_STATUSES)
    .gte("occurred_at", new Date(now.getTime() - STALE_ACTIVE_MS).toISOString())
    .neq("id", eventId)
  if (((dupes as unknown[]) ?? []).length > 0) {
    await (admin.from("outreach_events") as any).update({ call_status: "failed", send_error: "duplicate start" }).eq("id", eventId)
    return fail(409, "An AI call to this lead is already in progress.", "active_call")
  }

  try {
    const { providerCallId } = await provider.startCall({
      to: to!,
      from,
      variables,
      metadata: { lead_id: lead.id, agent_id: agent.id, outreach_event_id: eventId },
      idempotencyKey: `ble-${eventId}`,
      label: `ble-${eventId}`,
    })
    await (admin.from("outreach_events") as any)
      .update({ provider_call_id: providerCallId, call_status: "registered" })
      .eq("id", eventId)
      .eq("call_status", "queued") // a fast webhook may already have moved it on
    return NextResponse.json({ ok: true, eventId })
  } catch (err) {
    await (admin.from("outreach_events") as any)
      .update({
        call_status: "failed",
        status: "failed",
        send_error: err instanceof Error ? err.message.slice(0, 500) : "start failed",
      })
      .eq("id", eventId)
    return fail(502, "The call couldn't be started. Nothing was dialled.", "provider_error")
  }
}
