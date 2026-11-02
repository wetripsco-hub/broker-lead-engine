"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Check, X, Clock } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { useNow } from "@/lib/timezone/use-now"
import { formatLocalClock, formatLocalWeekday } from "@/lib/timezone/broker-time"
import { grantAfterHoursRequest, denyAfterHoursRequest } from "./actions"

export interface RequestRow {
  id: string
  status: "pending" | "granted" | "denied" | "used" | "expired"
  note: string
  denyReason: string | null
  requestedAt: string
  decidedAt: string | null
  expiresAt: string | null
  usedAt: string | null
  agentName: string
  leadId: string | null
  companyName: string
  mcNumber: string | null
  brokerTz: string | null
}

const STATUS_STYLE: Record<RequestRow["status"], string> = {
  pending: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  granted: "border-green-600/30 bg-green-600/10 text-green-700 dark:text-green-400",
  used: "border-border bg-muted text-muted-foreground",
  denied: "border-destructive/30 bg-destructive/10 text-destructive",
  expired: "border-border bg-muted text-muted-foreground",
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

function BrokerTime({ tz, now }: { tz: string | null; now: Date | null }) {
  if (!tz) return <span>unknown</span>
  if (!now) return <span>—</span>
  return (
    <span className="tabular-nums">
      {formatLocalClock(tz, now)} {formatLocalWeekday(tz, now).slice(0, 3)}
    </span>
  )
}

function LeadLink({ r }: { r: RequestRow }) {
  const label = (
    <>
      {r.companyName}
      {r.mcNumber && <span className="ml-1.5 font-mono text-xs text-muted-foreground">MC-{r.mcNumber}</span>}
    </>
  )
  return r.leadId ? (
    <Link href={`/leads/${r.leadId}`} className="font-medium hover:underline">
      {label}
    </Link>
  ) : (
    <span className="font-medium">{label}</span>
  )
}

export function RequestsClient({ pending, decided }: { pending: RequestRow[]; decided: RequestRow[] }) {
  const router = useRouter()
  const now = useNow(30_000)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [denyingId, setDenyingId] = useState<string | null>(null)
  const [reason, setReason] = useState("")

  // New requests show up without a reload.
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 15_000)
    return () => clearInterval(id)
  }, [router])

  async function grant(id: string) {
    setBusyId(id)
    const { error } = await grantAfterHoursRequest(id)
    setBusyId(null)
    if (error) toast.error(error)
    else {
      toast.success("Granted — the agent can make one call in the next 30 minutes")
      router.refresh()
    }
  }

  async function deny(id: string) {
    setBusyId(id)
    const { error } = await denyAfterHoursRequest(id, reason)
    setBusyId(null)
    if (error) toast.error(error)
    else {
      toast.success("Request denied")
      setDenyingId(null)
      setReason("")
      router.refresh()
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Requests</h1>
        <p className="text-sm text-muted-foreground mt-1">
          After-hours call requests from agents. A grant allows one call within 30 minutes.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Waiting ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <div className="rounded-lg border bg-card py-10 flex flex-col items-center gap-2 text-center">
            <Clock className="size-7 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No requests waiting.</p>
          </div>
        ) : (
          <div className="rounded-lg border bg-card divide-y">
            {pending.map((r) => (
              <div key={r.id} className="p-4 space-y-2 animate-in-fade">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm">
                      <span className="font-medium">{r.agentName}</span>
                      <span className="text-muted-foreground"> → </span>
                      <LeadLink r={r} />
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Broker&apos;s time now: <BrokerTime tz={r.brokerTz} now={now} /> · Requested {when(r.requestedAt)}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button size="sm" className="gap-1.5" disabled={busyId === r.id} onClick={() => grant(r.id)}>
                      <Check className="size-3.5" />
                      Grant
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      disabled={busyId === r.id}
                      onClick={() => {
                        setDenyingId(denyingId === r.id ? null : r.id)
                        setReason("")
                      }}
                    >
                      <X className="size-3.5" />
                      Deny
                    </Button>
                  </div>
                </div>
                <p className="rounded-md bg-muted/50 px-3 py-2 text-sm whitespace-pre-wrap break-words">{r.note}</p>
                {denyingId === r.id && (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      maxLength={500}
                      autoFocus
                      placeholder="Reason (optional)"
                      className="h-8 flex-1 min-w-48 rounded-md border border-input bg-transparent px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") deny(r.id)
                        if (e.key === "Escape") setDenyingId(null)
                      }}
                    />
                    <Button size="sm" variant="destructive" disabled={busyId === r.id} onClick={() => deny(r.id)}>
                      Deny request
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Recent decisions</h2>
        {decided.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing decided yet.</p>
        ) : (
          <div className="rounded-lg border bg-card divide-y">
            {decided.map((r) => (
              <div key={r.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-3 text-sm">
                <span className={`rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[r.status]}`}>
                  {r.status}
                </span>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p>
                    <span className="font-medium">{r.agentName}</span>
                    <span className="text-muted-foreground"> → </span>
                    <LeadLink r={r} />
                  </p>
                  <p className="text-xs text-muted-foreground break-words">
                    {r.note}
                    {r.status === "denied" && r.denyReason ? ` · Reason: ${r.denyReason}` : ""}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">
                  {r.decidedAt ? `Decided ${when(r.decidedAt)}` : `Requested ${when(r.requestedAt)}`}
                  {r.usedAt ? ` · Used ${when(r.usedAt)}` : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
