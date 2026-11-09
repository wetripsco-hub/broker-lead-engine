import { createHash } from "node:crypto"
import { agreementPlainText, getAgreement } from "./index"

/** SHA-256 (hex) of the exact agreement text served for a version, or null if the version is unknown. */
export function agreementSha256(version: string): string | null {
  const doc = getAgreement(version)
  return doc ? createHash("sha256").update(agreementPlainText(doc), "utf8").digest("hex") : null
}
