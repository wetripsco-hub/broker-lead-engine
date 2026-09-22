const TELNYX_API = "https://api.telnyx.com/v2"

function apiKey(): string {
  const k = process.env.TELNYX_API_KEY
  if (!k) throw new Error("TELNYX_API_KEY not set")
  return k
}

export interface SendSmsResult {
  id: string
  status: string
}

export async function sendSms(
  to: string,
  text: string,
  from?: string,
): Promise<SendSmsResult> {
  const fromNumber = from ?? process.env.TELNYX_SMS_NUMBER
  if (!fromNumber) throw new Error("TELNYX_SMS_NUMBER not set")

  const res = await fetch(`${TELNYX_API}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromNumber,
      to,
      text,
      messaging_profile_id: process.env.TELNYX_MESSAGING_PROFILE_ID,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Telnyx sendSms failed (${res.status}): ${body}`)
  }

  const { data } = await res.json()
  return { id: data.id, status: data.to?.[0]?.status ?? "queued" }
}
