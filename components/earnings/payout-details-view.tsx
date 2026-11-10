import { METHOD_LABEL, formatIban, type PayoutDetails } from "@/lib/payout-details"

/** Read-only list of an agent's payout details (admin Payouts page). */
export function PayoutDetailsView({ d }: { d: PayoutDetails | null | undefined }) {
  if (!d) return <p className="text-xs text-amber-700 dark:text-amber-400">The agent has not added payout details yet (My Account).</p>
  const rows: Array<[string, string | null, boolean?]> = [
    ["Method", METHOD_LABEL[d.method] ?? d.method],
    ["Account holder", d.account_holder],
    ["Lives in", d.country],
    ["Bank", d.bank_name],
    ["Bank country", d.bank_country],
    ["IBAN", d.iban ? formatIban(d.iban) : null, true],
    ["Account number", d.account_number, true],
    ["SWIFT / BIC", d.swift_bic, true],
    ["Branch / routing", d.branch_or_routing, true],
    ["Payment email", d.payment_email],
    ["Address", d.address],
    ["Notes", d.notes],
  ]
  return (
    <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-xs">
      {rows
        .filter(([, v]) => v)
        .map(([k, v, mono]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className={`min-w-0 break-all select-all ${mono ? "font-mono" : ""}`}>{v}</dd>
          </div>
        ))}
      {d.updated_at && (
        <div className="contents">
          <dt className="text-muted-foreground">Updated</dt>
          <dd>{new Date(d.updated_at).toLocaleDateString(undefined, { dateStyle: "medium" })}</dd>
        </div>
      )}
    </dl>
  )
}
