import { NextResponse } from "next/server"
import crypto from "crypto"
import { createClient } from "@/lib/supabase/server"
import { createCredential, mintToken } from "@/lib/telnyx/client"

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: agentRaw } = await (supabase.from("agents") as any)
      .select("id, name, telnyx_credential_id")
      .eq("user_id", user.id)
      .maybeSingle()

    if (!agentRaw) {
      return NextResponse.json({ error: "No agent record for this user" }, { status: 404 })
    }

    const agent = agentRaw as { id: string; name: string; telnyx_credential_id: string | null }
    let credentialId = agent.telnyx_credential_id

    if (!credentialId) {
      const connectionId = process.env.TELNYX_SIP_CONNECTION_ID
      if (!connectionId) {
        return NextResponse.json(
          { error: "TELNYX_SIP_CONNECTION_ID not configured" },
          { status: 500 },
        )
      }
      // Name must be unique per credential; use agent id prefix + random suffix
      const name = `ble-agent-${agent.id.slice(0, 8)}-${crypto.randomBytes(4).toString("hex")}`
      const credential = await createCredential(name, connectionId)
      credentialId = credential.id

      await (supabase.from("agents") as any)
        .update({ telnyx_credential_id: credentialId })
        .eq("id", agent.id)
    }

    const token = await mintToken(credentialId)
    return NextResponse.json({ token, agentId: agent.id, agentName: agent.name })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
