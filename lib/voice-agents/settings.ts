import type { SupabaseClient } from "@supabase/supabase-js"
import { toE164 } from "@/lib/phone"
import type { AiCallSettings } from "./gate"

export const AI_SETTING_KEYS = [
  "ai_calling_enabled",
  "ai_calling_test_mode",
  "ai_calling_test_numbers",
  "ai_calling_daily_cap",
] as const

/** Missing rows fall back to the safe defaults: off, test mode on, cap 20. */
export async function loadAiCallSettings(db: SupabaseClient<any, any, any>): Promise<AiCallSettings> {
  const { data } = await db.from("app_settings").select("key, value").in("key", [...AI_SETTING_KEYS])
  const m = new Map(((data ?? []) as Array<{ key: string; value: unknown }>).map((r) => [r.key, r.value]))
  const numbers = m.get("ai_calling_test_numbers")
  const cap = Number(m.get("ai_calling_daily_cap"))
  return {
    enabled: m.get("ai_calling_enabled") === true,
    testMode: m.get("ai_calling_test_mode") !== false,
    testNumbers: (Array.isArray(numbers) ? numbers : [])
      .map((n) => toE164(String(n)))
      .filter((n): n is string => !!n),
    dailyCap: Number.isFinite(cap) && cap >= 0 ? cap : 20,
  }
}
