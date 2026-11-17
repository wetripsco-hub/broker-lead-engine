import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isAdminInDb } from "@/lib/voice-agents/admin-check"
import { formatPhoneDisplay } from "@/lib/phone"
import { loadSettingsRow } from "@/lib/callbacks/server"
import { CallbacksClient, type CallbackItem } from "./callbacks-client"

// Admin: every inbound callback, with the caller's number, and the inbound settings.
// Agent: callbacks on leads assigned to them only (RLS), never a phone number.
export default async function CallbacksPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const admin = createAdminClient()
  const isAdmin = await isAdminInDb(admin, user.id)

  let items: CallbackItem[]
  if (isAdmin) {
    const { data } = await (admin.from("callbacks") as any)
      .select(
        "id, lead_id, status, missed_reason, received_at, recording_path, recording_seconds, transcript, transcript_status, handled_at, caller_number, agents ( name ), leads ( brokers ( company_name ), assigned:agents ( name ) )",
      )
      .order("received_at", { ascending: false })
      .limit(300)
    items = ((data ?? []) as any[]).map((r) => ({
      id: r.id,
      leadId: r.lead_id,
      companyName: r.leads?.brokers?.company_name ?? null,
      caller: r.caller_number ? formatPhoneDisplay(r.caller_number) : "Hidden number",
      agentName: r.agents?.name ?? null,
      assignedAgentName: r.leads?.assigned?.name ?? null,
      status: r.status,
      missedReason: r.missed_reason,
      receivedAt: r.received_at,
      hasRecording: !!r.recording_path,
      recordingSeconds: r.recording_seconds,
      transcript: r.transcript,
      transcriptStatus: r.transcript_status,
      handledAt: r.handled_at,
    }))
  } else {
    // Only the columns agents are granted; caller_number is not one of them.
    const { data } = await (supabase.from("callbacks") as any)
      .select("id, lead_id, status, missed_reason, received_at, recording_path, recording_seconds, transcript, transcript_status, handled_at, leads ( brokers ( company_name ) )")
      .not("lead_id", "is", null)
      .order("received_at", { ascending: false })
      .limit(300)
    items = ((data ?? []) as any[]).map((r) => ({
      id: r.id,
      leadId: r.lead_id,
      companyName: r.leads?.brokers?.company_name ?? null,
      caller: null,
      agentName: null,
      assignedAgentName: null,
      status: r.status,
      missedReason: r.missed_reason,
      receivedAt: r.received_at,
      hasRecording: !!r.recording_path,
      recordingSeconds: r.recording_seconds,
      transcript: r.transcript,
      transcriptStatus: r.transcript_status,
      handledAt: r.handled_at,
    }))
  }

  const settings = isAdmin ? await loadSettingsRow(admin) : null
  const { data: me } = await (supabase.from("agents") as any).select("name").eq("user_id", user.id).maybeSingle()

  return (
    <div className="p-3 sm:p-6 max-w-6xl mx-auto">
      <CallbacksClient
        items={items}
        isAdmin={isAdmin}
        settings={settings}
        callbackNumber={formatPhoneDisplay(process.env.NEXT_PUBLIC_TELNYX_FROM_NUMBER ?? "")}
        agentName={(me as { name: string } | null)?.name ?? null}
      />
    </div>
  )
}
