"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Check } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { resolveSupportRequest } from "./actions"

export interface SupportRequestRow {
  id: string
  loginId: string
  agentName: string | null
  message: string
  status: "open" | "resolved"
  createdAt: string
  resolvedAt: string | null
}

function pkt(iso: string): string {
  return (
    new Date(iso).toLocaleString("en-US", {
      timeZone: "Asia/Karachi",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }) + " PKT"
  )
}

export function SupportRequestsClient({ rows }: { rows: SupportRequestRow[] }) {
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    const id = setInterval(() => router.refresh(), 15_000)
    return () => clearInterval(id)
  }, [router])

  async function resolve(id: string) {
    setBusyId(id)
    const res = await resolveSupportRequest(id)
    setBusyId(null)
    if (res.error) toast.error(res.error)
    else {
      toast.success("Marked resolved")
      router.refresh()
    }
  }

  const open = rows.filter((r) => r.status === "open").length

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Support Requests</h1>
        <p className="text-sm text-muted-foreground">
          Sent from &quot;Contact Support&quot; on the login screen. {open} open. Reset passwords from the Agents page.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No support requests yet.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="rounded-lg border bg-card p-4 space-y-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="tabular-nums text-muted-foreground">{pkt(r.createdAt)}</span>
                <span className="font-mono text-xs">{r.loginId}</span>
                {r.agentName ? (
                  <span className="font-medium">{r.agentName}</span>
                ) : (
                  <span className="text-muted-foreground italic">No matching agent</span>
                )}
                <span
                  className={
                    "ml-auto rounded-full border px-2 py-0.5 text-[11px] font-medium " +
                    (r.status === "open"
                      ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                      : "border-border bg-muted text-muted-foreground")
                  }
                >
                  {r.status === "open" ? "Open" : "Resolved"}
                </span>
              </div>
              <p className="text-sm whitespace-pre-wrap break-words">{r.message}</p>
              <div className="flex flex-wrap items-center gap-2">
                {r.agentName && (
                  <Button size="sm" variant="outline" nativeButton={false} render={<Link href="/agents" />}>
                    Reset password on Agents page
                  </Button>
                )}
                {r.status === "open" ? (
                  <Button size="sm" onClick={() => resolve(r.id)} disabled={busyId === r.id}>
                    <Check className="size-3.5" />
                    {busyId === r.id ? "Saving…" : "Mark resolved"}
                  </Button>
                ) : (
                  r.resolvedAt && <span className="text-xs text-muted-foreground">Resolved {pkt(r.resolvedAt)}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
