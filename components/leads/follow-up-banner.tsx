"use client"

import { useTransition } from "react"
import { Clock, BellOff } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { EmailCompose, type ComposeTemplate } from "@/components/leads/email-compose"
import { snoozeFollowUp, updateLeadStage } from "@/app/(dashboard)/leads/actions"
import { ordinal } from "@/lib/follow-up/compute"
import { SNOOZE_LONG_DAYS, SNOOZE_SHORT_DAYS } from "@/lib/follow-up/config"

interface FollowUpBannerProps {
  leadId: string
  days: number
  /** Follow-ups already sent in this unanswered run. */
  followUpCount: number
  previousSubject: string | null
  brokerEmail: string | null
  templates: ComposeTemplate[]
  mergeVars: Record<string, string>
}

export function FollowUpBanner({
  leadId,
  days,
  followUpCount,
  previousSubject,
  brokerEmail,
  templates,
  mergeVars,
}: FollowUpBannerProps) {
  const [isPending, startTransition] = useTransition()

  function snooze(n: number, label: string) {
    startTransition(async () => {
      const { error } = await snoozeFollowUp(leadId, n)
      if (error) toast.error(`Snooze failed: ${error}`)
      else toast.success(`Follow-up snoozed for ${label}`)
    })
  }

  function markNotInterested() {
    startTransition(async () => {
      const { error } = await updateLeadStage(leadId, "dead")
      if (error) toast.error(`Failed to update stage: ${error}`)
      else toast.success("Marked as not interested")
    })
  }

  return (
    <div
      role="status"
      className="animate-in-rise rounded-lg border border-orange-300/60 bg-orange-50 px-4 py-3 dark:border-orange-800/60 dark:bg-orange-950/30"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <Clock className="size-4 shrink-0 text-orange-600 dark:text-orange-400" aria-hidden />
        <div className="min-w-0 flex-1 basis-64">
          <p className="text-sm font-medium text-orange-900 dark:text-orange-100">
            Emailed {days} {days === 1 ? "day" : "days"} ago, no reply yet. Send a follow-up?
          </p>
          <p className="mt-0.5 text-xs text-orange-800/80 dark:text-orange-200/70">
            This will be your {ordinal(followUpCount + 1)} follow-up
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <EmailCompose
            leadId={leadId}
            brokerEmail={brokerEmail}
            templates={templates}
            mergeVars={mergeVars}
            followUp={{ previousSubject }}
            triggerLabel="Send follow-up"
            triggerVariant="default"
          />
          <Button variant="outline" size="sm" disabled={isPending} onClick={() => snooze(SNOOZE_SHORT_DAYS, `${SNOOZE_SHORT_DAYS} days`)}>
            <BellOff className="size-3.5" />
            Snooze {SNOOZE_SHORT_DAYS} days
          </Button>
          <Button variant="outline" size="sm" disabled={isPending} onClick={() => snooze(SNOOZE_LONG_DAYS, "1 week")}>
            Snooze 1 week
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={isPending}
            className="text-muted-foreground hover:text-destructive"
            onClick={markNotInterested}
          >
            Mark as not interested
          </Button>
        </div>
      </div>
    </div>
  )
}
