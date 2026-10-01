import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { syncInbox } from "@/lib/email/imap-sync"

export const maxDuration = 60

/**
 * GET /api/email/sync
 *
 * Reads new INBOX mail over IMAP (read-only) and stores it as inbound email
 * events. Mail that arrived before the first sync is never imported — the
 * first run just records the current latest UID as the starting point.
 *
 * Auth — either:
 *   - `Authorization: Bearer <CRON_SECRET>` (the scheduler), or
 *   - a signed-in admin session (the "Sync now" button).
 * Anything else, including a wrong or missing token, gets 401. With no
 * CRON_SECRET configured the token path simply never matches.
 *
 * ── Scheduling ──────────────────────────────────────────────────────────
 * Vercel Hobby only runs crons once a day, so vercel.json carries a daily
 * fallback and the real schedule lives on cron-job.org:
 *
 *   1. Make sure CRON_SECRET is set in the Vercel project (Settings ->
 *      Environment Variables) and redeploy. Vercel's own daily cron then
 *      authenticates automatically with the same secret.
 *   2. Sign up at https://cron-job.org and click "Create cronjob".
 *   3. URL: https://<your-app>.vercel.app/api/email/sync   Method: GET
 *   4. Schedule: custom, every 2 minutes.
 *   5. Under "Advanced" -> "Headers", add:
 *        Authorization: Bearer <the same CRON_SECRET value>
 *   6. Save, then use "Test run": the response should be HTTP 200 with
 *      {"ok":true,...}. HTTP 401 means the header/secret doesn't match.
 *      The very first run only sets the starting point and imports nothing
 *      ("baselined": true) — replies are picked up from the next run on.
 */
export async function GET(req: NextRequest) {
  let authorised = false

  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get("authorization") === `Bearer ${secret}`) {
    authorised = true
  } else {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user?.user_metadata?.role === "admin") authorised = true
  }

  if (!authorised) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const result = await syncInbox()
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
