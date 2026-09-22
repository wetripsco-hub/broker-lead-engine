"use client"

import { useState, useTransition } from "react"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { updateLeadNotes } from "@/app/(dashboard)/leads/actions"
import { toast } from "sonner"

export function NotesEditor({ leadId, initialNotes }: { leadId: string; initialNotes: string | null }) {
  const [notes, setNotes] = useState(initialNotes ?? "")
  const [isPending, startTransition] = useTransition()
  const dirty = notes !== (initialNotes ?? "")

  function handleSave() {
    startTransition(async () => {
      const { error } = await updateLeadNotes(leadId, notes)
      if (error) toast.error(`Failed to save: ${error}`)
      else toast.success("Notes saved")
    })
  }

  return (
    <div className="space-y-2">
      <Textarea
        value={notes}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNotes(e.target.value)}
        placeholder="Add notes about this lead…"
        className="min-h-[120px] text-sm resize-none"
      />
      {dirty && (
        <Button size="sm" onClick={handleSave} disabled={isPending}>
          {isPending ? "Saving…" : "Save notes"}
        </Button>
      )}
    </div>
  )
}
