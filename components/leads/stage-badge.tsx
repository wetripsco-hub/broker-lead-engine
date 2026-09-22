import { Badge } from "@/components/ui/badge"
import type { LeadStage } from "@/types/database"

const STAGE_CONFIG: Record<LeadStage, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  new:        { label: "New",        variant: "default" },
  contacted:  { label: "Contacted",  variant: "secondary" },
  interested: { label: "Interested", variant: "default" },
  converted:  { label: "Converted",  variant: "default" },
  dead:       { label: "Dead",       variant: "outline" },
}

const STAGE_CLASSES: Record<LeadStage, string> = {
  new:        "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 border-transparent",
  contacted:  "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300 border-transparent",
  interested: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 border-transparent",
  converted:  "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300 border-transparent",
  dead:       "bg-muted text-muted-foreground border-transparent",
}

export function StageBadge({ stage }: { stage: LeadStage }) {
  return (
    <Badge
      variant={STAGE_CONFIG[stage].variant}
      className={STAGE_CLASSES[stage]}
    >
      {STAGE_CONFIG[stage].label}
    </Badge>
  )
}
