"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"

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

export type DispositionKey =
  | "no_answer"
  | "left_voicemail"
  | "answered_interested"
  | "answered_not_interested"
  | "callback"
  | "wrong_number"

export const DISPOSITION_LABEL: Record<DispositionKey, string> = {
  no_answer:               "No answer",
  left_voicemail:          "Left voicemail",
  answered_interested:     "Answered — interested",
  answered_not_interested: "Answered — not interested",
  callback:                "Call back later",
  wrong_number:            "Wrong number",
}

// Maps disposition to outreach_event status
const DISPOSITION_STATUS: Record<DispositionKey, "answered" | "no_answer"> = {
  no_answer:               "no_answer",
  left_voicemail:          "no_answer",
  answered_interested:     "answered",
  answered_not_interested: "answered",
  callback:                "answered",
  wrong_number:            "no_answer",
}

// Maps disposition to a lead stage update (null = no change)
const DISPOSITION_STAGE: Record<DispositionKey, string | null> = {
  no_answer:               null,
  left_voicemail:          "contacted",
  answered_interested:     "interested",
  answered_not_interested: "contacted",
  callback:                "contacted",
  wrong_number:            null,
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

  // Advance lead stage if disposition implies it
  const newStage = DISPOSITION_STAGE[disposition]
  if (newStage) {
    await (supabase.from("leads") as any)
      .update({ stage: newStage })
      .eq("id", leadId)
      // Only advance forward — don't demote an already-converted lead
      .in("stage", ["new", "contacted"])
  }

  revalidatePath(`/leads/${leadId}`)
  revalidatePath("/leads")
  return {}
}
