import { interpolate } from "@/lib/email/resend"
import { createClient } from "@/lib/supabase/server"
import { llmProvider } from "./llm"
import { OPENING_SCRIPT, type CopilotContext } from "./types"

type Supabase = Awaited<ReturnType<typeof createClient>>

/**
 * Signed-in agent + the lead's context. The lead is read through the user's
 * own session, so RLS decides access: an agent asking about someone else's
 * lead gets null, same as a lead that doesn't exist.
 */
export async function getCopilotContext(
  supabase: Supabase,
  userId: string,
  leadId: string,
): Promise<CopilotContext | null> {
  const [{ data: agentRaw }, { data: leadRaw }, { data: settingRaw }] = await Promise.all([
    (supabase.from("agents") as any).select("name").eq("user_id", userId).maybeSingle(),
    (supabase.from("leads") as any)
      .select("id, brokers ( company_name, contact_name, state, mc_number, mc_status )")
      .eq("id", leadId)
      .maybeSingle(),
    (supabase.from("app_settings") as any).select("value").eq("key", "announce_recording").maybeSingle(),
  ])

  const agent = agentRaw as { name: string } | null
  const lead = leadRaw as {
    brokers: {
      company_name: string | null
      contact_name: string | null
      state: string | null
      mc_number: string | null
      mc_status: string | null
    } | null
  } | null
  if (!agent || !lead?.brokers) return null

  const b = lead.brokers
  const companyName = b.company_name ?? "your company"
  // An agent record named after an email address ("someone@gmail.com") would be
  // read out in the script and quoted to the LLM. Show a fill-in-the-blank instead;
  // setting a display name in Settings replaces it.
  const spokenName = agent.name.includes("@") ? "[your name]" : agent.name
  return {
    agentName: spokenName,
    announceRecording: (settingRaw as { value: unknown } | null)?.value === true,
    llmProvider: llmProvider(),
    lead: {
      companyName,
      contactName: b.contact_name,
      state: b.state,
      mcNumber: b.mc_number,
      mcStatus: b.mc_status,
    },
    openingScript: interpolate(OPENING_SCRIPT, {
      contact_name: b.contact_name ?? "there",
      agent_name: spokenName,
      company_name: companyName,
    }),
  }
}

// Best-effort per-call limiter. In-memory, so it is per server instance —
// enough to stop a runaway client loop, not a hard quota.
const MAX_PER_CALL = 80
const MIN_GAP_MS = 1_500
const callUsage = new Map<string, { count: number; last: number }>()

export function checkRateLimit(callKey: string): boolean {
  const now = Date.now()
  if (callUsage.size > 500) {
    for (const [k, v] of callUsage) if (now - v.last > 3 * 3600_000) callUsage.delete(k)
  }
  const u = callUsage.get(callKey) ?? { count: 0, last: 0 }
  if (u.count >= MAX_PER_CALL || now - u.last < MIN_GAP_MS) return false
  callUsage.set(callKey, { count: u.count + 1, last: now })
  return true
}
