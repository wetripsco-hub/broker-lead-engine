"use client"

import { useTransition } from "react"
import { updateLeadStage } from "@/app/(dashboard)/leads/actions"
import { toast } from "sonner"
import type { LeadStage } from "@/types/database"

const STAGES: { value: LeadStage; label: string }[] = [
  { value: "new",        label: "New" },
  { value: "contacted",  label: "Contacted" },
  { value: "interested", label: "Interested" },
  { value: "converted",  label: "Converted" },
  { value: "dead",       label: "Dead" },
]

export function StageSelector({ leadId, stage }: { leadId: string; stage: LeadStage }) {
  const [isPending, startTransition] = useTransition()

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value as LeadStage
    startTransition(async () => {
      const { error } = await updateLeadStage(leadId, value)
      if (error) toast.error(`Failed to update stage: ${error}`)
      else toast.success("Stage updated")
    })
  }

  return (
    <select
      value={stage}
      onChange={handleChange}
      disabled={isPending}
      className="h-8 w-36 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 disabled:opacity-50 cursor-pointer"
    >
      {STAGES.map((s) => (
        <option key={s.value} value={s.value}>
          {s.label}
        </option>
      ))}
    </select>
  )
}
