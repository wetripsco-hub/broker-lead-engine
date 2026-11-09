import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { recruitImapConfigured, recruitSmtpConfigured, sendPace, RECRUIT_SYNC_KEY } from "@/lib/recruiter/mail"
import { isVideoProvider, type Provider } from "@/lib/recruiter/links"
import { createAdminClient } from "@/lib/supabase/admin"
import { loadAgreements } from "@/lib/agreement/admin"
import { RecruiterClient } from "./recruiter-client"
import type { AgreementRow } from "@/lib/agreement/format"
import type { Recruit, RecruitTemplate } from "./types"

export const dynamic = "force-dynamic"

export default async function RecruiterPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")
  // Admin only. RLS on the recruit tables blocks agents as well.
  if (user.app_metadata?.role !== "admin") redirect("/leads")

  const recruits: Recruit[] = []
  for (let from = 0; ; from += 1000) {
    const { data } = await (supabase.from("recruits") as any).select("*").order("created_at", { ascending: false }).range(from, from + 999)
    recruits.push(...((data ?? []) as Recruit[]))
    if (!data || data.length < 1000) break
  }

  const [{ data: templates }, { data: mediaRows }, { data: syncState }, { data: activeQueue }] = await Promise.all([
    (supabase.from("recruit_templates") as any).select("id, name, subject, body, updated_at").order("name"),
    (supabase.from("recruit_media") as any).select("recruit_id, source_type, provider, status").neq("status", "skipped"),
    (supabase.from("email_sync_state") as any).select("last_synced_at, last_error").eq("id", RECRUIT_SYNC_KEY).maybeSingle(),
    (supabase.from("recruit_send_queue") as any).select("batch_id").in("status", ["queued", "sending"]).order("created_at").limit(1),
  ])

  // Signed agent agreements (no browser policies on the table: read with the service role, admin proven above).
  let agreements: AgreementRow[] = []
  let newAgreements = 0
  try {
    agreements = await loadAgreements()
    const { data: seen } = await (createAdminClient().from("agreement_admin_seen") as any).select("last_seen_at").eq("admin_user_id", user.id).maybeSingle()
    newAgreements = agreements.filter((a) => !seen?.last_seen_at || a.signed_at > seen.last_seen_at).length
  } catch {
    // Migration not applied yet: the tab just shows nothing.
  }

  const withVideo = new Set<string>()
  for (const m of (mediaRows ?? []) as Array<{ recruit_id: string; source_type: string; provider: string }>) {
    if (m.source_type === "attachment" || isVideoProvider(m.provider as Provider)) withVideo.add(m.recruit_id)
  }

  const counters = {
    total: recruits.length,
    emailed: recruits.filter((r) => r.last_emailed_at).length,
    replied: recruits.filter((r) => r.last_reply_at).length,
    video: recruits.filter((r) => withVideo.has(r.id) || r.stage === "video_received").length,
    hired: recruits.filter((r) => r.stage === "hired").length,
  }

  return (
    <div className="p-3 sm:p-6 max-w-7xl mx-auto">
      <RecruiterClient
        recruits={recruits}
        templates={(templates ?? []) as RecruitTemplate[]}
        counters={counters}
        smtpReady={recruitSmtpConfigured()}
        imapReady={recruitImapConfigured()}
        pace={sendPace()}
        lastSyncedAt={syncState?.last_synced_at ?? null}
        syncError={syncState?.last_error ?? null}
        agreements={agreements}
        newAgreements={newAgreements}
        activeBatchId={((activeQueue ?? []) as any[])[0]?.batch_id ?? null}
      />
    </div>
  )
}
