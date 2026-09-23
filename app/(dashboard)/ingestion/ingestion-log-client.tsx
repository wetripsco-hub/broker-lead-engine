"use client"

import { useEffect, useState, useTransition } from "react"
import { ChevronDown, ChevronRight, RefreshCw, CheckCircle, XCircle, Loader2, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CensusUpload } from "@/components/ingestion/census-upload"
import { ScraperRunner } from "@/components/ingestion/scraper-runner"
import { PdfUploadRunner } from "@/components/ingestion/pdf-upload-runner"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { triggerManualIngest, deleteIngestionLog } from "./actions"
import type { CensusFileInfo } from "./upload-actions"
import type { Database } from "@/types/database"

type LogRow = Database["public"]["Tables"]["daily_ingestion_log"]["Row"]
type BrokerRow = Pick<
  Database["public"]["Tables"]["brokers"]["Row"],
  "id" | "mc_number" | "company_name" | "city" | "state" | "email" | "phone" | "registration_date"
>

interface IngestionLogClientProps {
  logs: (LogRow & { brokers: BrokerRow[] })[]
  isAdmin: boolean
  censusFileInfo: CensusFileInfo | null
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

function LogEntry({
  log,
  isAdmin,
  onDeleted,
}: {
  log: LogRow & { brokers: BrokerRow[] }
  isAdmin: boolean
  onDeleted: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [isDeleting, startDeleteTransition] = useTransition()
  const hasBrokers = log.brokers.length > 0

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm(`Delete the ${log.run_date} ingestion log entry?`)) return
    startDeleteTransition(async () => {
      const { error } = await deleteIngestionLog(log.id)
      if (error) toast.error(`Delete failed: ${error}`)
      else {
        toast.success("Log entry deleted")
        onDeleted(log.id)
      }
    })
  }

  return (
    <div className="border-b last:border-b-0">
      {/* Summary row */}
      <button
        onClick={() => hasBrokers && setOpen((v) => !v)}
        className={[
          "w-full flex items-center gap-3 px-4 py-3 text-sm text-left group",
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

        {isAdmin && (
          <span
            role="button"
            tabIndex={0}
            onClick={handleDelete}
            className="shrink-0 p-1 rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive hover:bg-destructive/10 transition-opacity"
            aria-label="Delete log entry"
          >
            {isDeleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
          </span>
        )}
      </button>

      {/* Per-run breakdown from the MOTUS enrichment step */}
      {(log.active_count > 0 ||
        log.pending_count > 0 ||
        log.skipped_count > 0 ||
        log.email_count > 0) && (
        <div className="px-11 pb-2.5 -mt-1 flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
          <span className="text-green-700 dark:text-green-400">{log.active_count} active</span>
          <span className="text-amber-700 dark:text-amber-400">{log.pending_count} pending</span>
          <span>{log.skipped_count} rejected/withdrawn skipped</span>
          <span>{log.email_count} emails found</span>
        </div>
      )}

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

export function IngestionLogClient({ logs: initialLogs, isAdmin, censusFileInfo }: IngestionLogClientProps) {
  const [logs, setLogs] = useState(initialLogs)
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<string | null>(null)
  const router = useRouter()

  useEffect(() => setLogs(initialLogs), [initialLogs])

  function handleDeleted(id: string) {
    setLogs((prev) => prev.filter((l) => l.id !== id))
  }

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

      {isAdmin && <CensusUpload initialInfo={censusFileInfo} />}
      {isAdmin && <ScraperRunner onFinished={() => router.refresh()} />}
      {isAdmin && <PdfUploadRunner onFinished={() => router.refresh()} />}

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
              <LogEntry key={log.id} log={log} isAdmin={isAdmin} onDeleted={handleDeleted} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
