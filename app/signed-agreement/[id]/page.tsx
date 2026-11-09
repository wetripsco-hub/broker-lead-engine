import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getAgreement } from "@/lib/agreement"
import { agreementSha256 } from "@/lib/agreement/hash"
import { loadAgreement, requireAgreementAdmin } from "@/lib/agreement/admin"
import { formatPkt, formatUtc } from "@/lib/agreement/format"
import { AgreementText } from "@/components/agreement/agreement-text"
import { PrintButton } from "./print-button"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Signed agreement", robots: { index: false, follow: false } }

// Admin only. Anyone else (agents, logged out) just gets a 404.
export default async function SignedAgreementPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAgreementAdmin())) notFound()
  const { id } = await params
  const row = await loadAgreement(id)
  if (!row) notFound()
  const doc = getAgreement(row.agreement_version)
  if (!doc) notFound()
  const hashMatches = agreementSha256(row.agreement_version) === row.agreement_sha256

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-8 sm:py-12">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-bold tracking-[0.2em] text-foreground">{doc.brand}</p>
          <PrintButton />
        </div>
        <AgreementText doc={doc} />

        <section className="rounded-xl bg-card p-5 text-sm ring-1 ring-foreground/10 sm:p-6 print:p-0 print:ring-0 print:break-inside-avoid">
          <h2 className="text-base font-semibold">{doc.signHeading}</h2>
          <p className="mt-1 text-muted-foreground">{doc.signIntro}</p>
          <p className="mt-3 leading-relaxed">{doc.consentLabel}</p>
          <div className="mt-4 space-y-1 rounded-lg bg-primary/10 px-4 py-3 print:border print:bg-transparent">
            <div>
              Signed by: <b>{row.full_name}</b>
            </div>
            <div>
              Email: <b className="break-all">{row.email}</b> · Country: <b>{row.country}</b>
            </div>
            <div>
              Date: <b>{formatPkt(row.signed_at)}</b> / <b>{formatUtc(row.signed_at)}</b> · Version <b>{row.agreement_version}</b>
            </div>
            <div>
              Reference: <b className="break-all font-mono">{row.reference}</b>
            </div>
            <div className="break-all text-xs text-muted-foreground">
              SHA-256 of the agreement text: <span className="font-mono">{row.agreement_sha256}</span>
            </div>
          </div>
          <p className={hashMatches ? "mt-3 text-xs text-muted-foreground print:hidden" : "mt-3 text-xs text-destructive print:hidden"}>
            {hashMatches
              ? "The text above matches the hash saved at signing."
              : "Warning: the text above does NOT match the hash saved at signing."}
          </p>
        </section>
      </div>
    </main>
  )
}
