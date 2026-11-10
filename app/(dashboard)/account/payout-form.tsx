"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PAYOUT_METHODS, ibanValid, type PayoutDetails, type PayoutMethod } from "@/lib/payout-details"
import { savePayoutDetails } from "./payout-actions"

type Form = Record<keyof Omit<PayoutDetails, "updated_at">, string>

function toForm(d: PayoutDetails | null): Form {
  return {
    method: d?.method ?? "bank",
    account_holder: d?.account_holder ?? "",
    country: d?.country ?? "",
    bank_name: d?.bank_name ?? "",
    bank_country: d?.bank_country ?? "",
    iban: d?.iban ?? "",
    account_number: d?.account_number ?? "",
    swift_bic: d?.swift_bic ?? "",
    branch_or_routing: d?.branch_or_routing ?? "",
    payment_email: d?.payment_email ?? "",
    address: d?.address ?? "",
    notes: d?.notes ?? "",
  }
}

function F({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function PayoutForm({ initial }: { initial: PayoutDetails | null }) {
  const [f, setF] = useState<Form>(() => toForm(initial))
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: e.target.value }))
  const method = f.method as PayoutMethod
  const ibanBad = method === "bank" && f.iban.trim() !== "" && !ibanValid(f.iban)

  function save(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    start(async () => {
      const r = await savePayoutDetails(f)
      if (r.error) setError(r.error)
      else toast.success("Payout details saved")
    })
  }

  const input = (k: keyof Form, props: React.ComponentProps<typeof Input> = {}) => (
    <Input id={`pd-${k}`} value={f[k]} onChange={set(k)} className="h-9 text-sm" {...props} />
  )

  return (
    <form onSubmit={save} className="space-y-3">
      <F id="pd-method" label="How do you want to be paid?">
        <select id="pd-method" value={f.method} onChange={set("method")} className="h-9 w-full rounded-lg border bg-background px-2.5 text-sm">
          {PAYOUT_METHODS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </F>
      <F id="pd-account_holder" label="Account holder full name">
        {input("account_holder", { autoComplete: "name", maxLength: 120 })}
      </F>
      <F id="pd-country" label="Country you live in">
        {input("country", { autoComplete: "country-name", maxLength: 80 })}
      </F>

      {method === "bank" && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <F id="pd-bank_name" label="Bank name">
              {input("bank_name", { maxLength: 120 })}
            </F>
            <F id="pd-bank_country" label="Bank country">
              {input("bank_country", { maxLength: 80 })}
            </F>
          </div>
          <F id="pd-iban" label="IBAN" hint={ibanBad ? "This IBAN does not look right. Please check it." : "If your bank has one (most countries outside the US)."}>
            {input("iban", { maxLength: 50, autoCapitalize: "characters", spellCheck: false, "aria-invalid": ibanBad || undefined, className: `h-9 text-sm font-mono ${ibanBad ? "border-destructive" : ""}` })}
          </F>
          <div className="grid gap-3 sm:grid-cols-2">
            <F id="pd-account_number" label="Account number" hint="Needed if you have no IBAN.">
              {input("account_number", { maxLength: 50, spellCheck: false, className: "h-9 text-sm font-mono" })}
            </F>
            <F id="pd-swift_bic" label="SWIFT / BIC">
              {input("swift_bic", { maxLength: 20, autoCapitalize: "characters", spellCheck: false, className: "h-9 text-sm font-mono" })}
            </F>
          </div>
          <F id="pd-branch_or_routing" label="Branch code / routing number (optional)">
            {input("branch_or_routing", { maxLength: 60 })}
          </F>
        </>
      )}

      {(method === "wise" || method === "payoneer" || method === "paypal") && (
        <F id="pd-payment_email" label={`${PAYOUT_METHODS.find((m) => m.id === method)?.label} account email`}>
          {input("payment_email", { type: "email", autoComplete: "email", maxLength: 160 })}
        </F>
      )}

      <F id="pd-address" label="Your address (optional)" hint="Some banks ask for it on international transfers.">
        {input("address", { autoComplete: "street-address", maxLength: 300 })}
      </F>
      <F id="pd-notes" label={method === "other" ? "How do you want to be paid?" : "Notes (optional)"}>
        <textarea id="pd-notes" value={f.notes} onChange={set("notes")} maxLength={500} rows={2} className="w-full rounded-lg border bg-background px-3 py-2 text-sm" />
      </F>

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-muted-foreground">Only you and the admin can see these details.</p>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  )
}
