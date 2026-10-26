// Server-side gathering of the facts behind evaluateSmsPermission. Used by every SMS-sending
// server action, so the rules cannot be bypassed by calling an action directly.
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { isAdminInDb } from "@/lib/voice-agents/admin-check"
import { evaluateSmsPermission, type SmsDecision } from "@/lib/sms-permission"
import { toE164 } from "@/lib/phone"

export async function checkSmsAllowed(
  supabase: SupabaseClient<any, any, any>,
  userId: string,
  opts: { leadId: string | null; to: string },
): Promise<SmsDecision> {
  const admin = createAdminClient() as any
  const to = toE164(opts.to) ?? opts.to

  const isAdmin = await isAdminInDb(admin, userId)

  let doNotCall = false
  let hasSmsConsent = false
  if (opts.leadId) {
    // Read through the signed-in user's client: row-level security decides if they can see the lead.
    const { data } = await (supabase.from("leads") as any)
      .select("do_not_call, sms_consent_at")
      .eq("id", opts.leadId)
      .maybeSingle()
    doNotCall = data?.do_not_call === true
    hasSmsConsent = !!data?.sms_consent_at
  }
  if (!doNotCall) {
    const { data: dnc } = await admin.from("do_not_call_numbers").select("id").eq("phone", to).maybeSingle()
    doNotCall = !!dnc
  }

  let hasInbound = false
  if (!isAdmin && !hasSmsConsent) {
    const { data: inbound } = await admin
      .from("outreach_events")
      .select("id")
      .eq("channel", "sms")
      .eq("direction", "inbound")
      .eq("from_number", to)
      .limit(1)
    hasInbound = (inbound ?? []).length > 0
  }

  return evaluateSmsPermission({ isAdmin, doNotCall, hasSmsConsent, hasInbound })
}
