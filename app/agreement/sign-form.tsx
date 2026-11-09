"use client"

import { useState } from "react"
import { Check, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { AgreementDoc } from "@/lib/agreement"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface Signed {
  name: string
  signedAt: string
  reference: string
  version: string
}

export function SignForm({ doc }: { doc: AgreementDoc }) {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [country, setCountry] = useState("")
  const [agree, setAgree] = useState(false)
  const [website, setWebsite] = useState("") // honeypot: real people never see or fill this
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [signed, setSigned] = useState<Signed | null>(null)

  const valid =
    name.trim().length >= 3 &&
    name.trim().length <= 120 &&
    EMAIL_RE.test(email.trim()) &&
    country.trim().length >= 2 &&
    country.trim().length <= 80 &&
    agree

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/agreement/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: name.trim(),
          email: email.trim(),
          country: country.trim(),
          version: doc.version,
          agreed: true,
          website,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || "Could not sign. Please try again.")
      setSigned({
        name: name.trim(),
        signedAt: j.signedAt ?? new Date().toISOString(),
        reference: j.reference ?? "",
        version: j.version ?? doc.version,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  if (signed) {
    return (
      <section className="rounded-xl bg-card p-5 ring-1 ring-foreground/10 sm:p-6" aria-live="polite">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Check className="size-5 text-primary" /> Agreement signed
        </h2>
        <div className="mt-3 space-y-1 rounded-lg bg-primary/10 px-4 py-3 text-sm">
          <div>
            Signed by: <b>{signed.name}</b>
          </div>
          <div>
            Date:{" "}
            <b>
              {new Date(signed.signedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "long" })}
            </b>{" "}
            · Version <b>{signed.version}</b>
          </div>
          <div>
            Reference: <b className="break-all font-mono">{signed.reference}</b>
          </div>
        </div>
        <p className="mt-3 text-sm leading-relaxed">{doc.doneThanks}</p>
        <Button type="button" className="mt-4 w-full gap-2 sm:w-auto print:hidden" onClick={() => window.print()}>
          <Printer className="size-4" />
          Save a copy (PDF)
        </Button>
      </section>
    )
  }

  return (
    <section className="rounded-xl bg-card p-5 ring-1 ring-foreground/10 sm:p-6 print:hidden">
      <h2 className="text-base font-semibold">{doc.signHeading}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{doc.signIntro}</p>

      <form onSubmit={submit} noValidate className="mt-4 space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="ag-name" className="text-sm font-medium">
            Full legal name
          </label>
          <Input
            id="ag-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            required
            minLength={3}
            maxLength={120}
            className="h-10 text-base sm:text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="ag-email" className="text-sm font-medium">
            Email address
          </label>
          <Input
            id="ag-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
            maxLength={160}
            className="h-10 text-base sm:text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="ag-country" className="text-sm font-medium">
            Country
          </label>
          <Input
            id="ag-country"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            autoComplete="country-name"
            required
            maxLength={80}
            className="h-10 text-base sm:text-sm"
          />
        </div>

        {/* Honeypot, off-screen and out of the tab order. */}
        <div aria-hidden="true" style={{ position: "absolute", left: -9999, width: 1, height: 1, overflow: "hidden" }}>
          <label htmlFor="website">Website</label>
          <input
            id="website"
            name="website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </div>

        <div className="flex items-start gap-3">
          <input
            id="ag-agree"
            type="checkbox"
            checked={agree}
            onChange={(e) => setAgree(e.target.checked)}
            className="mt-1 size-[18px] shrink-0 accent-[var(--primary)]"
          />
          <label htmlFor="ag-agree" className="text-sm leading-relaxed">
            {doc.consentLabel}
          </label>
        </div>

        <Button type="submit" disabled={!valid || busy} className="w-full sm:w-auto">
          {busy ? "Signing…" : "Sign agreement"}
        </Button>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </form>
    </section>
  )
}
