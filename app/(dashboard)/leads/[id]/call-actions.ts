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

// Saved the moment the call ends, so a transcript is never lost if the agent
// closes the dialog before confirming the outcome. RLS limits the update to
// events on leads the agent can see.
export async function saveCallTranscript(
  eventId: string,
  transcript: string,
): Promise<{ error?: string }> {
  const text = transcript.trim()
  if (!text) return {}
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }
  const { error } = await (supabase.from("outreach_events") as any)
    .update({ transcript: text.slice(0, 200_000) })
    .eq("id", eventId)
  return error ? { error: error.message } : {}
}

export async function saveCallDisposition(
  eventId: string,
  leadId: string,
  disposition: DispositionKey,
  notes: string,
  durationSeconds: number,
  extra: { aiSummary?: string | null; followUpDate?: string | null } = {},
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
    extra.followUpDate ? `Follow up: ${extra.followUpDate}` : null,
  ]
    .filter(Boolean)
    .join("\n")

  const { error: evErr } = await (supabase.from("outreach_events") as any)
    .update({
      status: DISPOSITION_STATUS[disposition],
      message_body: messageBody,
      ...(extra.aiSummary ? { ai_summary: extra.aiSummary } : {}),
      ...(extra.followUpDate ? { follow_up_date: extra.followUpDate } : {}),
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
