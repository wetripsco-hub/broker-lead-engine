import { createPublicKey, verify } from "crypto"

const MAX_AGE_SECONDS = 300
// DER prefix that turns a raw 32-byte ed25519 key into an SPKI key.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex")

// Telnyx signs `${timestamp}|${rawBody}` with ed25519.
export function isValidTelnyxSignature(
  rawBody: string,
  signature: string | null,
  timestamp: string | null,
  publicKeyBase64: string,
  now: Date = new Date(),
): boolean {
  if (!signature || !timestamp) return false
  const sentAt = Number(timestamp)
  if (!Number.isFinite(sentAt) || Math.abs(now.getTime() / 1000 - sentAt) > MAX_AGE_SECONDS) return false
  try {
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyBase64, "base64")]),
      format: "der",
      type: "spki",
    })
    return verify(null, Buffer.from(`${timestamp}|${rawBody}`), key, Buffer.from(signature, "base64"))
  } catch {
    return false
  }
}
