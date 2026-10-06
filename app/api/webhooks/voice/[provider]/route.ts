import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getVoiceProviderById } from "@/lib/voice-agents"
import { processVoiceEvent } from "@/lib/voice-agents/process"

// Provider webhooks (Retell: call_started / call_ended / call_analyzed).
// No user session here: authenticity comes from the signature, checked on the
// RAW body before anything is parsed.
export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: providerId } = await params
  const provider = getVoiceProviderById(providerId)
  if (!provider) return NextResponse.json({ error: "Unknown provider" }, { status: 404 })

  const rawBody = await request.text()
  if (!provider.verifyWebhook(rawBody, request.headers)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const event = provider.normalizeEvent(payload)
  if (!event) return NextResponse.json({ ok: true, ignored: true }) // events we don't act on

  try {
    const result = await processVoiceEvent(createAdminClient(), provider.id, event)
    return NextResponse.json({ ok: true, ...result })
  } catch {
    // 500 makes the provider retry; processing is idempotent so that's safe.
    return NextResponse.json({ error: "Processing failed" }, { status: 500 })
  }
}
