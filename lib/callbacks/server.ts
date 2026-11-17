// Server-side helpers for inbound callbacks (service role). Never import from client code.

import { createAdminClient } from "@/lib/supabase/admin"
import { toE164, formatPhoneDisplay } from "@/lib/phone"
import { sendEmail } from "@/lib/email/send"
import { DEFAULT_GREETING, MISSED_REASON_LABEL, pickCallbackLead, type LeadCandidate } from "@/lib/callbacks/rules"
import type { InboundSettings } from "@/lib/telnyx/inbound"

type Admin = ReturnType<typeof createAdminClient>

export interface InboundSettingsRow {
  forward_to: string | null
  ring_timeout_secs: number
  hours_enabled: boolean
  timezone: string
  open_days: number[]
  open_time: string
  close_time: string
  greeting: string
  notify_email: string | null
}

export const DEFAULT_SETTINGS_ROW: InboundSettingsRow = {
  forward_to: null,
  ring_timeout_secs: 20,
  hours_enabled: true,
  timezone: "America/Chicago",
  open_days: [1, 2, 3, 4, 5],
  open_time: "09:00",
  close_time: "17:00",
  greeting: DEFAULT_GREETING,
  notify_email: null,
}

export async function loadSettingsRow(admin: Admin = createAdminClient()): Promise<InboundSettingsRow> {
  const { data } = await (admin.from("inbound_call_settings") as any).select("*").eq("id", true).maybeSingle()
  const row = (data ?? {}) as Partial<InboundSettingsRow>
  return {
    ...DEFAULT_SETTINGS_ROW,
    ...Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null && v !== undefined)),
    forward_to: row.forward_to ?? null,
    notify_email: row.notify_email ?? null,
    open_time: String(row.open_time ?? DEFAULT_SETTINGS_ROW.open_time).slice(0, 5),
    close_time: String(row.close_time ?? DEFAULT_SETTINGS_ROW.close_time).slice(0, 5),
    greeting: row.greeting?.trim() || DEFAULT_GREETING,
  } as InboundSettingsRow
}

export function toInboundSettings(r: InboundSettingsRow): InboundSettings {
  return {
    forwardTo: r.forward_to,
    ringTimeoutSecs: r.ring_timeout_secs,
    greeting: r.greeting,
    hours: { enabled: r.hours_enabled, timezone: r.timezone, openDays: r.open_days, openTime: r.open_time, closeTime: r.close_time },
  }
}

/** Every lead whose broker (or a direct-dial number an agent called) matches the caller. */
export async function matchCallerToLead(admin: Admin, e164: string): Promise<{ leadId: string; agentId: string | null } | null> {
  const brokerIds = new Set<string>()
  const { data: exact } = await (admin.from("brokers") as any).select("id").eq("phone_e164", e164).limit(50)
  for (const b of (exact ?? []) as Array<{ id: string }>) brokerIds.add(b.id)

  // Brokers saved before phone_e164 existed: narrow by the last four digits, compare normalised.
  const last4 = e164.replace(/\D/g, "").slice(-4)
  if (brokerIds.size === 0 && last4.length === 4) {
    const { data: loose } = await (admin.from("brokers") as any)
      .select("id, phone")
      .is("phone_e164", null)
      .ilike("phone", `%${last4}%`)
      .limit(200)
    for (const b of (loose ?? []) as Array<{ id: string; phone: string | null }>) if (toE164(b.phone) === e164) brokerIds.add(b.id)
  }

  const leadIds = new Set<string>()
  // A direct number (e.g. a broker official) that an agent dialled.
  const { data: direct } = await (admin.from("outreach_events") as any)
    .select("lead_id")
    .eq("direct_number_e164", e164)
    .not("lead_id", "is", null)
    .limit(50)
  for (const d of (direct ?? []) as Array<{ lead_id: string }>) leadIds.add(d.lead_id)

  const leadRows: Array<{ id: string; assigned_agent_id: string | null; created_at: string }> = []
  if (brokerIds.size > 0) {
    const { data } = await (admin.from("leads") as any).select("id, assigned_agent_id, created_at").in("broker_id", [...brokerIds])
    leadRows.push(...((data ?? []) as typeof leadRows))
  }
  const missing = [...leadIds].filter((id) => !leadRows.some((l) => l.id === id))
  if (missing.length > 0) {
    const { data } = await (admin.from("leads") as any).select("id, assigned_agent_id, created_at").in("id", missing)
    leadRows.push(...((data ?? []) as typeof leadRows))
  }
  if (leadRows.length === 0) return null

  const { data: calls } = await (admin.from("outreach_events") as any)
    .select("lead_id, agent_id, occurred_at")
    .in("lead_id", leadRows.map((l) => l.id))
    .eq("channel", "call")
    .eq("direction", "outbound")
    .order("occurred_at", { ascending: false })
    .limit(500)
  const lastCall = new Map<string, { at: string; agentId: string }>()
  for (const c of (calls ?? []) as Array<{ lead_id: string; agent_id: string; occurred_at: string }>) {
    if (!lastCall.has(c.lead_id)) lastCall.set(c.lead_id, { at: c.occurred_at, agentId: c.agent_id })
  }

  const candidates: LeadCandidate[] = leadRows.map((l) => ({
    leadId: l.id,
    assignedAgentId: l.assigned_agent_id,
    createdAt: l.created_at,
    lastCall: lastCall.get(l.id) ?? null,
  }))
  return pickCallbackLead(candidates)
}

/** Deepgram pre-recorded transcription of the voicemail mp3. */
export async function transcribeVoicemail(bytes: ArrayBuffer): Promise<{ text: string; seconds: number | null }> {
  const key = process.env.DEEPGRAM_API_KEY
  if (!key) throw new Error("DEEPGRAM_API_KEY not set")
  const res = await fetch("https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&punctuate=true&language=en-US", {
    method: "POST",
    headers: { Authorization: `Token ${key}`, "Content-Type": "audio/mpeg" },
    body: bytes,
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`Deepgram failed (${res.status}): ${(await res.text()).slice(0, 200)}`)
  const json = (await res.json()) as {
    metadata?: { duration?: number }
    results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> }
  }
  return {
    text: json.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "",
    seconds: typeof json.metadata?.duration === "number" ? json.metadata.duration : null,
  }
}

async function adminEmails(admin: Admin, configured: string | null): Promise<string[]> {
  if (configured?.trim()) return configured.split(/[,;\s]+/).filter((e) => e.includes("@"))
  const out: string[] = []
  for (let page = 1; page <= 5; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error || !data?.users?.length) break
    for (const u of data.users) if (u.app_metadata?.role === "admin" && u.email) out.push(u.email)
    if (data.users.length < 200) break
  }
  return out
}

export interface CallbackEmailInput {
  status: string
  missedReason: string | null
  receivedAt: string
  callerNumber: string | null
  companyName: string | null
  agentName: string | null
  transcript: string | null
  recordingSeconds: number | null
  link: string
}

export function callbackEmail(c: CallbackEmailInput): { subject: string; text: string } {
  const who = c.companyName ?? (c.callerNumber ? formatPhoneDisplay(c.callerNumber) : "Unknown caller")
  const isVm = c.status === "voicemail"
  const subject = isVm ? `New voicemail from ${who}` : `Missed callback from ${who}`
  const when = new Date(c.receivedAt).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" })
  const lines = [
    isVm ? "A broker left a voicemail." : "A broker called back and nobody answered.",
    "",
    `Caller: ${who}${c.companyName && c.callerNumber ? ` (${formatPhoneDisplay(c.callerNumber)})` : ""}`,
    `Time: ${when} (Central)`,
    `Agent who last called: ${c.agentName ?? "none (unknown caller or never called)"}`,
    c.missedReason ? `Why missed: ${MISSED_REASON_LABEL[c.missedReason] ?? c.missedReason}` : null,
    isVm && c.recordingSeconds !== null ? `Length: ${c.recordingSeconds}s` : null,
    isVm ? "" : null,
    isVm ? `Transcript: ${c.transcript?.trim() || "(not available)"}` : null,
    "",
    `Listen and mark handled: ${c.link}`,
  ].filter((l): l is string => l !== null)
  return { subject, text: lines.join("\n") }
}

export async function notifyAdminOfCallback(admin: Admin, callbackId: string): Promise<void> {
  const { data } = await (admin.from("callbacks") as any)
    .select("status, missed_reason, received_at, caller_number, transcript, recording_seconds, leads ( brokers ( company_name ) ), agents ( name )")
    .eq("id", callbackId)
    .maybeSingle()
  if (!data) return
  const row = data as any
  const settings = await loadSettingsRow(admin)
  const to = await adminEmails(admin, settings.notify_email)
  if (to.length === 0) {
    console.error("inbound: no admin email to notify")
    return
  }
  const site = (process.env.NEXT_PUBLIC_SITE_URL || "https://sell.loadlinkers.co").replace(/\/$/, "")
  const { subject, text } = callbackEmail({
    status: row.status,
    missedReason: row.missed_reason,
    receivedAt: row.received_at,
    callerNumber: row.caller_number,
    companyName: row.leads?.brokers?.company_name ?? null,
    agentName: row.agents?.name ?? null,
    transcript: row.transcript,
    recordingSeconds: row.recording_seconds,
    link: `${site}/callbacks`,
  })
  for (const addr of to) {
    const r = await sendEmail({ to: addr, subject, text })
    if (r.error) console.error("inbound: admin email failed", r.error)
  }
}
