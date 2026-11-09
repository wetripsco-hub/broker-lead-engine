// One place for the agreement text and its version. To publish a new version:
// add lib/agreement/v<next>.ts, register it below and move AGREEMENT_VERSION.
// Old versions stay registered forever, so an old signature can always be shown
// with the exact text that person signed.
import { AGREEMENT_V1_0 } from "./v1.0"
import type { AgreementDoc } from "./types"

export type { AgreementDoc, AgreementBlock } from "./types"

export const AGREEMENT_VERSION = "1.0"

const REGISTRY: Record<string, AgreementDoc> = {
  "1.0": AGREEMENT_V1_0,
}

export function getAgreement(version: string): AgreementDoc | null {
  return REGISTRY[version] ?? null
}

export function currentAgreement(): AgreementDoc {
  return REGISTRY[AGREEMENT_VERSION]
}

/**
 * The exact text a signer is shown, as one deterministic string. Its SHA-256 is
 * stored with every signature (see ./hash.ts).
 */
export function agreementPlainText(doc: AgreementDoc): string {
  const lines: string[] = [doc.brand, doc.eyebrow, doc.title, `Version ${doc.version}`, `Effective ${doc.effectiveLabel}`, doc.company, doc.readPrompt, ""]
  for (const s of doc.sections) {
    lines.push(s.heading)
    for (const b of s.blocks) {
      if (b.type === "p") lines.push(b.text)
      else b.items.forEach((t, i) => lines.push(`${i + 1}. ${t}`))
    }
    lines.push("")
  }
  lines.push(doc.signHeading, doc.signIntro, doc.consentLabel)
  return lines.join("\n")
}
