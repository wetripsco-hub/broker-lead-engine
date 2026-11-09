"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { RefreshCw, Inbox, Users, FileText, FileSignature, AlertTriangle } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { syncRecruitReplies } from "./actions"
import { AgreementsPanel } from "./agreements-panel"
import { InboxPanel } from "./inbox-panel"
import { RecruitsPanel } from "./recruits-panel"
import { TemplatesPanel } from "./templates-panel"
import type { AgreementRow } from "@/lib/agreement/format"
import type { Recruit, RecruitTemplate } from "./types"

type Tab = "inbox" | "recruits" | "templates" | "agreements"

export interface RecruiterProps {
  recruits: Recruit[]
  templates: RecruitTemplate[]
  counters: { total: number; emailed: number; replied: number; video: number; hired: number }
  smtpReady: boolean
  imapReady: boolean
  pace: { minSeconds: number; maxSeconds: number; maxPerHour: number }
  lastSyncedAt: string | null
  syncError: string | null
  activeBatchId: string | null
  agreements: AgreementRow[]
  newAgreements: number
}

export function RecruiterClient(props: RecruiterProps) {
  const { recruits, templates, counters, smtpReady, imapReady, lastSyncedAt, syncError } = props
  const [tab, setTab] = useState<Tab>("inbox")
  const [syncing, startSync] = useTransition()
  const router = useRouter()
  const unread = recruits.filter((r) => r.unread).length
  // Badge: signatures since the admin last opened the tab. Opening the tab clears it.
  const [agreementsSeen, setAgreementsSeen] = useState(false)
  const newAgreements = agreementsSeen ? 0 : props.newAgreements

  function refresh() {
    startSync(async () => {
      const r = await syncRecruitReplies()
      if (r.error) toast.error(r.error)
      else if (r.baselined) toast.success("Inbox connected. New replies will show from now on.")
      else toast.success(r.imported ? `${r.imported} new ${r.imported === 1 ? "reply" : "replies"}` : "No new replies")
      router.refresh()
    })
  }

  const stats = [
    { label: "Total", value: counters.total },
    { label: "Emailed", value: counters.emailed },
    { label: "Replied", value: counters.replied },
    { label: "Video received", value: counters.video },
    { label: "Hired", value: counters.hired },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Recruiter</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Recruit sales agents from info@loadlinkers.co. Only admins can see this.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastSyncedAt && (
            <span className="text-xs text-muted-foreground" title={syncError ?? undefined}>
              Synced {new Date(lastSyncedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </span>
          )}
          <Button size="sm" variant="outline" onClick={refresh} disabled={syncing || !imapReady} className="gap-1.5">
            <RefreshCw className={cn("size-3.5", syncing && "animate-spin")} />
            {syncing ? "Checking…" : "Refresh"}
          </Button>
        </div>
      </div>

      {(!smtpReady || !imapReady) && (
        <div className="flex gap-2 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="size-4 shrink-0 mt-px" />
          <span>
            {!smtpReady && "Sending is off until RECRUIT_SMTP_HOST, RECRUIT_SMTP_PORT, RECRUIT_SMTP_USER, RECRUIT_SMTP_PASS and RECRUIT_FROM_NAME are set in Vercel. "}
            {!imapReady && "Reply sync is off until RECRUIT_IMAP_HOST, RECRUIT_IMAP_PORT, RECRUIT_IMAP_USER and RECRUIT_IMAP_PASS are set in Vercel."}
          </span>
        </div>
      )}
      {syncError && imapReady && (
        <p className="text-xs text-destructive">Last reply sync failed: {syncError}</p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border bg-card px-3 py-2.5">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{s.label}</p>
            <p className="text-xl font-semibold tabular-nums mt-0.5">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-1 border-b">
        {(
          [
            { id: "inbox", label: "Inbox", icon: Inbox, badge: unread },
            { id: "recruits", label: "Recruits", icon: Users, badge: 0 },
            { id: "templates", label: "Templates", icon: FileText, badge: 0 },
            { id: "agreements", label: "Agreements", icon: FileSignature, badge: newAgreements },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setTab(t.id)
              if (t.id === "agreements") setAgreementsSeen(true)
            }}
            className={cn(
              "relative flex items-center gap-1.5 px-3 py-2 text-sm transition-colors duration-150",
              tab === t.id ? "text-foreground font-medium" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <t.icon className="size-3.5" />
            {t.label}
            {t.badge > 0 && (
              <span className="ml-0.5 rounded-full bg-primary px-1.5 text-[10px] font-medium text-primary-foreground tabular-nums">{t.badge}</span>
            )}
            {tab === t.id && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />}
          </button>
        ))}
      </div>

      {tab === "inbox" && <InboxPanel recruits={recruits} templates={templates} smtpReady={smtpReady} />}
      {tab === "recruits" && <RecruitsPanel {...props} onGoToTemplates={() => setTab("templates")} />}
      {tab === "templates" && <TemplatesPanel templates={templates} />}
      {tab === "agreements" && <AgreementsPanel agreements={props.agreements} />}
    </div>
  )
}
