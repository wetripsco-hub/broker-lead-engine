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
  return telnyxSignatureProblem(rawBody, signature, timestamp, publicKeyBase64, now) === null
}

/** null = valid; otherwise a short reason for the log (never includes the key or signature). */
export function telnyxSignatureProblem(
  rawBody: string,
  signature: string | null,
  timestamp: string | null,
  publicKeyBase64: string,
  now: Date = new Date(),
): string | null {
  if (!signature || !timestamp) return "missing telnyx-signature-ed25519 / telnyx-timestamp header"
  const sentAt = Number(timestamp)
  if (!Number.isFinite(sentAt)) return "timestamp header is not a number"
  if (Math.abs(now.getTime() / 1000 - sentAt) > MAX_AGE_SECONDS) return "timestamp older than 5 minutes"
  const raw = Buffer.from(publicKeyBase64.trim(), "base64")
  if (raw.length !== 32) return `TELNYX_PUBLIC_KEY decodes to ${raw.length} bytes, expected 32 (wrong or incomplete key)`
  try {
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: "der", type: "spki" })
    return verify(null, Buffer.from(`${timestamp}|${rawBody}`), key, Buffer.from(signature, "base64"))
      ? null
      : "signature does not match TELNYX_PUBLIC_KEY (key from a different Telnyx account, or an old key)"
  } catch (e) {
    return `could not use TELNYX_PUBLIC_KEY: ${(e as Error).message}`
  }
}
