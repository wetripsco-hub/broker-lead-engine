import { NextRequest, NextResponse } from "next/server"
import { syncInbox } from "@/lib/email/imap-sync"

export const maxDuration = 60

/**
 * GET /api/email/sync
 *
 * Pulls new INBOX mail over IMAP and stores it as inbound email events.
 * Hit by an external scheduler (cron-job.org every 2 minutes, or Vercel Cron
 * on a plan that allows it); admins can also trigger it from the Emails page.
 *
 * Security: requires `Authorization: Bearer <CRON_SECRET>` (what Vercel Cron
 * sends) or `x-cron-secret: <CRON_SECRET>`. Unlike /api/ingest this fails
 * CLOSED — with no CRON_SECRET configured, nobody gets in.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 })
  }

  const bearer = req.headers.get("authorization")
  const header = req.headers.get("x-cron-secret")
  if (bearer !== `Bearer ${secret}` && header !== secret) {
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
