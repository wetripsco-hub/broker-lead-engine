import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { AgentsClient } from "./agents-client"

export default async function AgentsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")
  // Server-side gate — the sidebar hides this link for agents, but that
  // alone doesn't stop a direct URL visit.
  if (user.user_metadata?.role !== "admin") redirect("/leads")

  // select("*") so a column whose migration isn't applied yet just comes back
  // missing instead of failing the whole page. Deleted agents (kept for their
  // history) are hidden.
  const [{ data: agentsRaw }, lastSignIn] = await Promise.all([
    supabase.from("agents").select("*").order("created_at", { ascending: true }),
    lastSignInByUser(),
  ])
  const agents = ((agentsRaw ?? []) as any[])
    .filter((a) => !a.deleted_at)
    .map((a) => ({
      id: a.id as string,
      name: a.name as string,
      email: (a.email ?? null) as string | null,
      active: a.active as boolean,
      created_at: a.created_at as string,
      onboarding_completed_at: (a.onboarding_completed_at ?? null) as string | null,
      last_seen_at: (a.last_seen_at ?? null) as string | null,
      last_signed_out_at: (a.last_signed_out_at ?? null) as string | null,
      last_sign_in_at: lastSignIn.get(a.user_id) ?? null,
    }))

  const { data: leadCountsRaw } = await supabase
    .from("leads")
    .select("assigned_agent_id")
    .not("assigned_agent_id", "is", null)

  const leadCounts: Record<string, number> = {}
  for (const l of (leadCountsRaw ?? []) as Array<{ assigned_agent_id: string }>) {
    leadCounts[l.assigned_agent_id] = (leadCounts[l.assigned_agent_id] ?? 0) + 1
  }

  return (
    <div className="p-3 sm:p-6 max-w-4xl mx-auto">
      <AgentsClient agents={agents} leadCounts={leadCounts} />
    </div>
  )
}

/** Last successful sign-in per auth user (Supabase Auth keeps it; the agents table doesn't). */
async function lastSignInByUser(): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  try {
    const { data } = await createAdminClient().auth.admin.listUsers({ page: 1, perPage: 1000 })
    for (const u of data?.users ?? []) if (u.last_sign_in_at) out.set(u.id, u.last_sign_in_at)
  } catch {
    /* page still works without it */
  }
  return out
}
