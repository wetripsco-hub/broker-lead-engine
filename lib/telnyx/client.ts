const TELNYX_API = "https://api.telnyx.com/v2"

function apiKey(): string {
  const k = process.env.TELNYX_API_KEY
  if (!k) throw new Error("TELNYX_API_KEY not set")
  return k
}

function authHeaders() {
  return {
    Authorization: `Bearer ${apiKey()}`,
    "Content-Type": "application/json",
  }
}

export async function createCredential(
  name: string,
  connectionId: string,
): Promise<{ id: string; sip_username: string }> {
  const res = await fetch(`${TELNYX_API}/telephony_credentials`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ name, connection_id: connectionId }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Telnyx createCredential failed (${res.status}): ${body}`)
  }
  const { data } = await res.json()
  return { id: data.id, sip_username: data.sip_username }
}

export async function mintToken(credentialId: string): Promise<string> {
  const res = await fetch(`${TELNYX_API}/telephony_credentials/${credentialId}/token`, {
    method: "POST",
    headers: authHeaders(),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Telnyx mintToken failed (${res.status}): ${body}`)
  }
  const { token } = await res.json()
  return token
}

export async function startCallRecording(callControlId: string): Promise<void> {
  const res = await fetch(
    `${TELNYX_API}/calls/${callControlId}/actions/record_start`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        format: "mp3",
        channels: "dual",
        play_beep: false,
      }),
    },
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Telnyx startCallRecording failed (${res.status}): ${body}`)
  }
}
