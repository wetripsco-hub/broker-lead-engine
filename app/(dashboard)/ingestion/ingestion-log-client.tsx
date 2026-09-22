"use client"

import { useState, useTransition } from "react"
import { ChevronDown, ChevronRight, RefreshCw, CheckCircle, XCircle, Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { triggerManualIngest } from "./actions"
import type { Database } from "@/types/database"

type LogRow = Database["public"]["Tables"]["daily_ingestion_log"]["Row"]
type BrokerRow = Pick<
  Database["public"]["Tables"]["brokers"]["Row"],
  "id" | "mc_number" | "company_name" | "city" | "state" | "email" | "phone" | "registration_date"
>

interface IngestionLogClientProps {
  logs: (LogRow & { brokers: BrokerRow[] })[]
  isAdmin: boolean
}

function StatusBadge({ status }: { status: LogRow["status"] }) {
  if (status === "success")
    return (
      <Badge variant="default" className="gap-1.5 font-normal">
        <CheckCircle className="size-3" />
        success
      </Badge>
    )
  if (status === "error")
    return (
      <Badge variant="destructive" className="gap-1.5 font-normal">
        <XCircle className="size-3" />
        error
      </Badge>
    )
  return (
    <Badge variant="secondary" className="gap-1.5 font-normal">
      <Loader2 className="size-3 animate-spin" />
      running
    </Badge>
  )
}

function duration(log: LogRow): string {
  if (!log.finished_at) return "—"
  const ms = new Date(log.finished_at).getTime() - new Date(log.started_at).getTime()
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function LogEntry({ log }: { log: LogRow & { brokers: BrokerRow[] } }) {
  const [open, setOpen] = useState(false)
  const hasBrokers = log.brokers.length > 0

  return (
    <div className="border-b last:border-b-0">
      {/* Summary row */}
      <button
        onClick={() => hasBrokers && setOpen((v) => !v)}
        className={[
          "w-full flex items-center gap-3 px-4 py-3 text-sm text-left",
          hasBrokers ? "hover:bg-muted/50 cursor-pointer" : "cursor-default",
        ].join(" ")}
        aria-expanded={hasBrokers ? open : undefined}
      >
        <span className="text-muted-foreground shrink-0 w-4">
          {hasBrokers ? (
            open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />
          ) : null}
        </span>

        <span className="w-28 shrink-0 font-mono text-xs text-muted-foreground">
          {log.run_date}
        </span>

        <StatusBadge status={log.status} />

        <span className="flex-1 tabular-nums text-muted-foreground">
          <span className="text-foreground font-medium">{log.new_count}</span> new ·{" "}
          {log.updated_count} updated · {log.fetched_count} fetched
        </span>

        <span className="text-muted-foreground text-xs shrink-0">{duration(log)}</span>
      </button>

      {/* Error message */}
      {log.status === "error" && log.error_message && (
        <div className="px-11 pb-3">
          <p className="text-xs text-destructive font-mono bg-destructive/10 px-3 py-2 rounded">
            {log.error_message}
          </p>
        </div>
      )}

      {/* Expanded broker rows */}
      {open && hasBrokers && (
        <div className="border-t bg-muted/30">
          <div className="px-11 py-2">
            <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">
              New brokers from this run
            </p>
            <div className="space-y-1">
              {log.brokers.map((b) => (
                <div key={b.id} className="flex items-center gap-4 py-1.5 text-sm border-b border-border/50 last:border-0">
                  <span className="font-mono text-xs text-muted-foreground w-20 shrink-0">
                    MC-{b.mc_number}
                  </span>
                  <span className="font-medium truncate flex-1">{b.company_name}</span>
                  <span className="text-muted-foreground text-xs shrink-0">
                    {[b.city, b.state].filter(Boolean).join(", ")}
                  </span>
                  {b.email && (
                    <span className="text-muted-foreground text-xs truncate max-w-[160px] shrink-0">
                      {b.email}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function IngestionLogClient({ logs, isAdmin }: IngestionLogClientProps) {
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<string | null>(null)

  function handleManualRun() {
    startTransition(async () => {
      const res = await triggerManualIngest()
      setResult(res.message)
      setTimeout(() => setResult(null), 8000)
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Ingestion Log</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Daily FMCSA broker data runs · Runs at 06:00 UTC
          </p>
        </div>
        {isAdmin && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleManualRun}
            disabled={isPending}
            className="gap-2"
          >
            <RefreshCw className={["size-3.5", isPending ? "animate-spin" : ""].join(" ")} />
            {isPending ? "Running…" : "Run now"}
          </Button>
        )}
      </div>

      {result && (
        <div className="text-sm px-3 py-2 rounded border bg-muted text-muted-foreground">
          {result}
        </div>
      )}

      <div className="rounded-lg border bg-card">
        {logs.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No ingestion runs yet. Click "Run now" to trigger the first run, or wait for the daily
            cron at 06:00 UTC.
          </div>
        ) : (
          <div>
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-2 border-b text-xs font-medium text-muted-foreground uppercase tracking-wide">
              <span className="w-4 shrink-0" />
              <span className="w-28 shrink-0">Date</span>
              <span className="w-20 shrink-0">Status</span>
              <span className="flex-1">Counts</span>
              <span>Duration</span>
            </div>
            {logs.map((log) => (
              <LogEntry key={log.id} log={log} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
