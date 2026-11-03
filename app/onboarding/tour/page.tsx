import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { HOURLY_CALL_LIMIT } from "@/lib/agent-hourly-limit"
import { firstName, initialTourStep } from "@/lib/onboarding"
import { TourClient } from "./tour-client"

// Agent only. ?replay=1 (Help menu) reopens the tour without touching any flags.
export default async function TourPage({ searchParams }: { searchParams: Promise<{ replay?: string }> }) {
  const { replay: replayParam } = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")
  if (user.user_metadata?.role === "admin") redirect("/dashboard")

  const { data } = await (supabase.from("agents") as any)
    .select("name, onboarding_step, onboarding_completed_at")
    .eq("user_id", user.id)
    .maybeSingle()
  const agent = data as { name: string; onboarding_step: number | null; onboarding_completed_at: string | null } | null

  // Finished agents only get here through replay.
  const replay = replayParam === "1" || !!agent?.onboarding_completed_at

  return (
    <TourClient
      initialStep={initialTourStep(agent?.onboarding_step, replay)}
      replay={replay}
      agentFirstName={firstName(agent?.name)}
      hourlyCallLimit={HOURLY_CALL_LIMIT}
    />
  )
}
