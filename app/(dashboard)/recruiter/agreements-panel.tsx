"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ExternalLink, Search, UserPlus, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { formatPkt, formatUtc, type AgreementRow, type AgreementStatus } from "@/lib/agreement/format"
import { markAgreementsSeen, rejectAgreement } from "./agreements-actions"

const STATUS_LABEL: Record<AgreementStatus, string> = {
  signed: "Signed",
  account_created: "Account created",
  rejected: "Rejected",
}

const STATUS_STYLE: Record<AgreementStatus, string> = {
  signed: "bg-primary/10 text-primary",
  account_created: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
  rejected: "bg-muted text-muted-foreground",
}

function StatusPill({ status }: { status: AgreementStatus }) {
  return <span className={cn("inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium", STATUS_STYLE[status])}>{STATUS_LABEL[status]}</span>
}

export function AgreementsPanel({ agreements }: { agreements: AgreementRow[] }) {
  const router = useRouter()
  const [q, setQ] = useState("")
  const [status, setStatus] = useState<"all" | AgreementStatus>("all")
  const [openId, setOpenId] = useState<string | null>(null)

  // Opening the tab counts as seeing the new signatures.
  useEffect(() => {
    markAgreementsSeen().then(() => router.refresh())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return agreements.filter(
      (r) => (status === "all" || r.status === status) && (!needle || r.full_name.toLowerCase().includes(needle) || r.email.toLowerCase().includes(needle)),
    )
  }, [agreements, q, status])

  const open = agreements.find((r) => r.id === openId) ?? null

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or email" className="h-9 pl-8 text-sm" />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          aria-label="Filter by status"
          className="h-9 rounded-lg border bg-background px-2.5 text-sm"
        >
          <option value="all">All statuses</option>
          <option value="signed">Signed</option>
          <option value="account_created">Account created</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      {agreements.length === 0 ? (
        <p className="rounded-lg border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          No signatures yet. Share <span className="font-mono">sell.loadlinkers.co/agreement</span> with new agents.
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border bg-card px-4 py-8 text-center text-sm text-muted-foreground">No signatures match.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-medium">Reference</th>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 font-medium">Country</th>
                <th className="px-3 py-2 font-medium">Version</th>
                <th className="px-3 py-2 font-medium">Signed at</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} onClick={() => setOpenId(r.id)} className="cursor-pointer border-b last:border-0 transition-colors hover:bg-muted/50">
                  <td className="px-3 py-2 font-mono text-xs">
                    <button className="text-left font-medium hover:underline" onClick={() => setOpenId(r.id)}>
                      {r.reference}
                    </button>
                  </td>
                  <td className="px-3 py-2">{r.full_name}</td>
                  <td className="px-3 py-2 break-all">{r.email}</td>
                  <td className="px-3 py-2">{r.country}</td>
                  <td className="px-3 py-2 tabular-nums">{r.agreement_version}</td>
                  <td className="px-3 py-2 text-xs leading-snug text-muted-foreground">
                    <div>{formatPkt(r.signed_at)}</div>
                    <div>{formatUtc(r.signed_at)}</div>
                  </td>
                  <td className="px-3 py-2">
                    <StatusPill status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && <DetailModal row={open} onClose={() => setOpenId(null)} />}
    </div>
  )
}

function Field({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[130px_1fr] sm:gap-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0 break-words text-sm", mono && "font-mono text-xs")}>{children}</dd>
    </div>
  )
}

function DetailModal({ row, onClose }: { row: AgreementRow; onClose: () => void }) {
  const router = useRouter()
  const [rejecting, setRejecting] = useState(false)
  const [note, setNote] = useState("")
  const [pending, startTransition] = useTransition()

  function reject() {
    startTransition(async () => {
      const r = await rejectAgreement(row.id, note)
      if (r.error) toast.error(r.error)
      else {
        toast.success("Signature rejected")
        setRejecting(false)
        router.refresh()
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-3 sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-xl rounded-xl border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Signature {row.reference}</h2>
            <StatusPill status={row.status} />
          </div>
          <button onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        <dl className="space-y-2.5 px-5 py-4">
          <Field label="Full name">{row.full_name}</Field>
          <Field label="Email">{row.email}</Field>
          <Field label="Country">{row.country}</Field>
          <Field label="Version">{row.agreement_version}</Field>
          <Field label="Signed at">
            {formatPkt(row.signed_at)}
            <br />
            {formatUtc(row.signed_at)}
          </Field>
          <Field label="IP address" mono>
            {row.ip ?? "not recorded"}
          </Field>
          <Field label="User agent" mono>
            {row.user_agent ?? "not recorded"}
          </Field>
          <Field label="Agreement SHA-256" mono>
            {row.agreement_sha256}
          </Field>
          <Field label="Status">{STATUS_LABEL[row.status]}</Field>
          {row.agent_user_id && (
            <Field label="Agent user id" mono>
              {row.agent_user_id}
            </Field>
          )}
          {row.admin_note && <Field label="Admin note">{row.admin_note}</Field>}
        </dl>

        {rejecting && (
          <div className="space-y-2 border-t px-5 py-4">
            <label htmlFor="reject-note" className="text-xs text-muted-foreground">
              Note (optional)
            </label>
            <textarea
              id="reject-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={1000}
              rows={3}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setRejecting(false)} disabled={pending}>
                Cancel
              </Button>
              <Button variant="destructive" size="sm" onClick={reject} disabled={pending}>
                {pending ? "Rejecting…" : "Reject signature"}
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t px-5 py-4">
          <Link
            href={`/signed-agreement/${row.id}`}
            target="_blank"
            rel="noopener"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium hover:bg-muted"
          >
            <ExternalLink className="size-3.5" />
            View signed agreement
          </Link>
          {row.status === "signed" && !rejecting && (
            <>
              <Link
                href={`/agents?fromAgreement=${row.id}`}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                <UserPlus className="size-3.5" />
                Create agent account
              </Link>
              <Button variant="outline" size="sm" onClick={() => setRejecting(true)}>
                Reject
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
