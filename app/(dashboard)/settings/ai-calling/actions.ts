"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { toE164 } from "@/lib/phone"

export async function saveAiCallingSettings(input: {
  enabled: boolean
  testMode: boolean
  testNumbers: string
  dailyCap: number
}): Promise<{ error?: string; testNumbers?: string[] }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user?.user_metadata?.role !== "admin") return { error: "admin only" }

  const cap = Math.floor(Number(input.dailyCap))
  if (!Number.isFinite(cap) || cap < 0 || cap > 1000) return { error: "Daily cap must be between 0 and 1000" }

  const raw = input.testNumbers
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const numbers: string[] = []
  for (const r of raw) {
    const n = toE164(r)
    if (!n) return { error: `"${r}" isn't a valid phone number` }
    if (!numbers.includes(n)) numbers.push(n)
  }

  const now = new Date().toISOString()
  const { error } = (await (supabase.from("app_settings") as any).upsert([
    { key: "ai_calling_enabled", value: !!input.enabled, updated_at: now },
    { key: "ai_calling_test_mode", value: !!input.testMode, updated_at: now },
    { key: "ai_calling_test_numbers", value: numbers, updated_at: now },
    { key: "ai_calling_daily_cap", value: cap, updated_at: now },
  ])) as { error: { message: string } | null }
  if (error) return { error: error.message }

  revalidatePath("/settings/ai-calling")
  revalidatePath("/leads", "layout")
  return { testNumbers: numbers }
}
