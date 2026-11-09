export type AgreementBlock = { type: "p"; text: string } | { type: "ol"; items: string[] }

export interface AgreementDoc {
  version: string
  /** ISO date the version took effect. */
  effective: string
  brand: string
  eyebrow: string
  title: string
  effectiveLabel: string
  company: string
  readPrompt: string
  /** Sections 1-11. Section 12 (the signature block) is the three fields below. */
  sections: Array<{ heading: string; blocks: AgreementBlock[] }>
  signHeading: string
  signIntro: string
  consentLabel: string
  doneThanks: string
  footer: string
}
