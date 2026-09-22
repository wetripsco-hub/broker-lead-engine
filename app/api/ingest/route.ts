import { NextRequest, NextResponse } from "next/server"
import { IngestionService } from "@/lib/ingestion/service"
import { FmcsaCensusProvider } from "@/lib/fmcsa/census-provider"
import { MockBrokerDataProvider } from "@/lib/fmcsa/mock-provider"

// Max 5 minutes — sufficient for downloading + parsing the census file
export const maxDuration = 300

/**
 * POST /api/ingest
 *
 * Called by Vercel Cron daily at 06:00 UTC, and available for
 * manual runs (admin only, from the Ingestion Log page).
 *
 * Security: requires Authorization: Bearer <CRON_SECRET>
 *
 * Body (optional JSON):
 *   { "since": "2026-09-21" }  — override the lookback date
 *   { "mock": true }           — use MockBrokerDataProvider (dev/testing)
 */
export async function POST(req: NextRequest) {
  // Auth check
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get("authorization") ?? ""
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  let since: Date | undefined
  let useMock = process.env.FMCSA_USE_MOCK === "true"

  try {
    const body = await req.json().catch(() => ({}))
    if (body.since) since = new Date(body.since)
    if (body.mock === true) useMock = true
  } catch {
    // no body — fine
  }

  const provider = useMock ? new MockBrokerDataProvider() : new FmcsaCensusProvider()
  const service = new IngestionService(provider)

  try {
    const summary = await service.run(since)
    return NextResponse.json({ ok: true, provider: provider.name, ...summary })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[ingest] run failed:", message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

// Vercel Cron calls GET; forward to POST handler
export async function GET(req: NextRequest) {
  return POST(req)
}
