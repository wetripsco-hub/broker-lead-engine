import type { Metadata } from "next"
import { currentAgreement } from "@/lib/agreement"
import { AgreementText } from "@/components/agreement/agreement-text"
import { SignForm } from "./sign-form"

export const metadata: Metadata = {
  title: "Sales Agent Agreement · Loadlinkers",
  description: "Loadlinkers sales agent code of conduct and commission agreement.",
  robots: { index: false, follow: false },
}

export default function AgreementPage() {
  const doc = currentAgreement()
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-8 sm:py-12">
        <p className="text-xs font-bold tracking-[0.2em] text-foreground">{doc.brand}</p>
        <AgreementText doc={doc} />
        <SignForm doc={doc} />
        <footer className="text-sm text-muted-foreground">{doc.footer}</footer>
      </div>
    </main>
  )
}
