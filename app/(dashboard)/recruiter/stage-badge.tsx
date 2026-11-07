import { cn } from "@/lib/utils"
import { STAGE_LABEL, type RecruitStage } from "./types"

const TONE: Record<RecruitStage, string> = {
  new: "bg-muted text-muted-foreground",
  emailed: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  replied: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
  video_received: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  interview: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200",
  hired: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  rejected: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200",
}

export function StageBadge({ stage, className }: { stage: RecruitStage; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap", TONE[stage] ?? TONE.new, className)}>
      {STAGE_LABEL[stage] ?? stage}
    </span>
  )
}
