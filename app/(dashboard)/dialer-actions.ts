"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"

export async function logDirectCallStarted(
  agentId: string,
  phoneNumber: string,
  externalId: string | null,
): Promise<{ error?: string; eventId?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  const { data, error } = await (supabase.from("outreach_events") as any)
    .insert({
      lead_id: null,
      agent_id: agentId,
      channel: "call",
      status: "pending",
      direction: "outbound",
      direct_number: phoneNumber,
      external_id: externalId,
    })
    .select("id")
    .single()

  if (error) return { error: error.message }
  return { eventId: (data as { id: string }).id }
}

export async function saveDirectCallEnd(
  eventId: string,
  status: "answered" | "no_answer",
  notes: string,
  durationSeconds: number,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  const messageBody = [
    `Duration: ${durationSeconds}s`,
    notes.trim() ? `Notes: ${notes.trim()}` : null,
  ]
    .filter(Boolean)
    .join("\n")

  const { error } = await (supabase.from("outreach_events") as any)
    .update({ status, message_body: messageBody })
    .eq("id", eventId)

  if (error) return { error: error.message }

  revalidatePath("/dashboard")
  return {}
}

export interface DirectCallHistoryItem {
  id: string
  direct_number: string
  status: string
  message_body: string | null
  occurred_at: string
}

export type HistoryFilter = "today" | "week" | "all"

export async function getDirectCallHistory(
  filter: HistoryFilter,
): Promise<{ error?: string; events?: DirectCallHistoryItem[] }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  const { data: agentRaw } = await (supabase.from("agents") as any)
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle()
  if (!agentRaw) return { error: "No agent record" }
  const agentId = (agentRaw as { id: string }).id

  let query = (supabase.from("outreach_events") as any)
    .select("id, direct_number, status, message_body, occurred_at")
    .eq("agent_id", agentId)
    .eq("channel", "call")
    .not("direct_number", "is", null)
    .order("occurred_at", { ascending: false })
    .limit(100)

  if (filter === "today") {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    query = query.gte("occurred_at", start.toISOString())
  } else if (filter === "week") {
    const start = new Date(Date.now() - 7 * 86_400_000)
    query = query.gte("occurred_at", start.toISOString())
  }

  const { data, error } = await query
  if (error) return { error: error.message }
  return { events: (data ?? []) as DirectCallHistoryItem[] }
}
