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
      external_id: externalId,
    })
    .select("id")
    .single()

  if (error) return { error: error.message }
  return { eventId: (data as { id: string }).id }
}

export async function logCallEnded(
  eventId: string,
  outcome: {
    status: "answered" | "no_answer" | "failed"
    durationSeconds?: number
    recordingUrl?: string | null
  },
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  const { error } = await (supabase.from("outreach_events") as any)
    .update({
      status: outcome.status,
      recording_url: outcome.recordingUrl ?? null,
      // store duration as JSON in message_body if no dedicated column yet
      ...(outcome.durationSeconds != null
        ? { message_body: `Duration: ${outcome.durationSeconds}s` }
        : {}),
    })
    .eq("id", eventId)

  if (error) return { error: error.message }

  // Refresh lead detail page so timeline reflects the new call
  revalidatePath(`/leads`, "layout")
  return {}
}
