import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { recruiterAdmin } from "@/lib/recruiter/auth"
import { RECRUIT_SYNC_KEY, recruitImapConfigured, recruitSmtpConfigured } from "@/lib/recruiter/mail"
import { runQueue } from "@/lib/recruiter/send-queue"
import { syncRecruitInbox } from "@/lib/recruiter/sync"

export const dynamic = "force-dynamic"
export const maxDuration = 60

const SYNC_EVERY_MS = 5 * 60_000 - 20_000

/**
 * GET /api/recruiter/cron   (Authorization: Bearer <CRON_SECRET>, or an admin session)
 *
 * Schedule on cron-job.org every 1 minute (same header as /api/email/sync):
 *   - sends queued recruiter emails at the configured pace (~1 per 20–30 s)
 *   - syncs replies from info@loadlinkers.co when the last sync is 5+ minutes old
 * vercel.json keeps a daily fallback.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const viaCron = !!secret && req.headers.get("authorization") === `Bearer ${secret}`
  if (!viaCron && !(await recruiterAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const out: Record<string, unknown> = { ok: true }
  const admin = createAdminClient()

  if (recruitImapConfigured()) {
    const { data } = await (admin.from("email_sync_state") as any).select("last_synced_at").eq("id", RECRUIT_SYNC_KEY).maybeSingle()
    const last = data?.last_synced_at ? new Date(data.last_synced_at).getTime() : 0
    if (req.nextUrl.searchParams.get("sync") === "1" || Date.now() - last >= SYNC_EVERY_MS) {
      try {
        out.sync = await syncRecruitInbox()
      } catch (err) {
        out.sync = { error: err instanceof Error ? err.message : String(err) }
      }
    }
  }

  if (recruitSmtpConfigured()) {
    try {
      out.send = await runQueue(40_000)
    } catch (err) {
      out.send = { error: err instanceof Error ? err.message : String(err) }
    }
  }
  return NextResponse.json(out)
}
