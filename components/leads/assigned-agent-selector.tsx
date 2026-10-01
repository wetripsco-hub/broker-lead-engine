"use client"

import { useState, useTransition } from "react"
import { assignLead } from "@/app/(dashboard)/leads/actions"
import { toast } from "sonner"

interface Agent {
  id: string
  name: string
}

export function AssignedAgentSelector({
  leadId,
  assignedAgentId,
  agents,
}: {
  leadId: string
  assignedAgentId: string | null
  agents: Agent[]
}) {
  const [value, setValue] = useState(assignedAgentId ?? "")
  const [isPending, startTransition] = useTransition()

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value || null
    setValue(next ?? "")
    startTransition(async () => {
      const { error } = await assignLead(leadId, next)
      if (error) {
        toast.error(`Failed to assign: ${error}`)
        setValue(assignedAgentId ?? "")
      } else {
        toast.success(next ? "Lead assigned" : "Lead unassigned")
      }
    })
  }

  return (
    <select
      value={value}
      onChange={handleChange}
      disabled={isPending}
      className="w-full h-8 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
    >
      <option value="">Unassigned</option>
      {agents.map((a) => (
        <option key={a.id} value={a.id}>{a.name}</option>
      ))}
    </select>
  )
}
