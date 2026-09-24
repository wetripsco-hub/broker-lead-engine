"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import {
  DISPOSITION_LABEL,
  DISPOSITION_STATUS,
  DISPOSITION_STAGE,
} from "@/lib/call-dispositions"
import type { DispositionKey } from "@/lib/call-dispositions"

export type { DispositionKey }

export async function logCallStarted(
  leadId: string,
  agentId: string,
  externalId: string | null,
): Promise<{ error?: string; eventId?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  const { data, error } = await (supabase.from("outreach_events") as any)
    .insert({
      lead_id: leadId,
      agent_id: agentId,
      channel: "call",
      status: "pending",
      direction: "outbound",
      external_id: externalId,
    })
    .select("id")
    .single()

  if (error) return { error: error.message }
  return { eventId: (data as { id: string }).id }
}

export async function saveCallDisposition(
  eventId: string,
  leadId: string,
  disposition: DispositionKey,
  notes: string,
  durationSeconds: number,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  const label = DISPOSITION_LABEL[disposition]
  const messageBody = [
    `Disposition: ${label}`,
    `Duration: ${durationSeconds}s`,
    notes.trim() ? `Notes: ${notes.trim()}` : null,
  ]
    .filter(Boolean)
    .join("\n")

  const { error: evErr } = await (supabase.from("outreach_events") as any)
    .update({
      status: DISPOSITION_STATUS[disposition],
      message_body: messageBody,
    })
    .eq("id", eventId)

  if (evErr) return { error: evErr.message }

  const newStage = DISPOSITION_STAGE[disposition]
  if (newStage) {
    await (supabase.from("leads") as any)
      .update({ stage: newStage })
      .eq("id", leadId)
      .in("stage", ["new", "contacted"])
  }

  revalidatePath(`/leads/${leadId}`)
  revalidatePath("/leads")
  return {}
}
