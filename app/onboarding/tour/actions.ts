"use server"

import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { TOUR_STEP_COUNT } from "@/lib/onboarding"

// The agent's own row (RLS: agents_update allows user_id = auth.uid()).
// Only the two onboarding columns are written.

export async function saveOnboardingStep(step: number): Promise<void> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return
  const clamped = Math.max(0, Math.min(TOUR_STEP_COUNT - 1, Math.floor(step)))
  await (supabase.from("agents") as any).update({ onboarding_step: clamped }).eq("user_id", user.id)
}

export async function completeOnboarding(): Promise<void> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")
  await (supabase.from("agents") as any)
    .update({ onboarding_completed_at: new Date().toISOString(), onboarding_step: TOUR_STEP_COUNT - 1 })
    .eq("user_id", user.id)
    .is("onboarding_completed_at", null)
  redirect("/leads")
}
