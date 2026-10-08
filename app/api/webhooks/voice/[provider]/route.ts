import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getVoiceProviderById, parseWebhook } from "@/lib/voice-agents"
import { processVoiceEvent } from "@/lib/voice-agents/process"

// Provider webhooks (Retell: call_started / call_ended / call_analyzed;
// Vapi: status-update / end-of-call-report). No user session here:
// authenticity comes from the provider's signature or shared secret, checked
// on the RAW body before anything is parsed.
export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: providerId } = await params
  const provider = getVoiceProviderById(providerId)
  if (!provider) return NextResponse.json({ error: "Unknown provider" }, { status: 404 })

  const rawBody = await request.text()
  const parsed = parseWebhook(provider, rawBody, request.headers)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status })
  if (parsed.events.length === 0) return NextResponse.json({ ok: true, ignored: true }) // events we don't act on

  try {
    const db = createAdminClient()
    const results = []
    for (const event of parsed.events) results.push(await processVoiceEvent(db, provider.id, event))
    return NextResponse.json({ ok: true, results })
  } catch {
    // 500 makes the provider retry; processing is idempotent so that's safe.
    return NextResponse.json({ error: "Processing failed" }, { status: 500 })
  }
}
