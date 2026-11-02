import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isAdminInDb } from "@/lib/voice-agents/admin-check"
import { KnowledgeClient, type KbItem } from "./knowledge-client"

// Admin only. Agents read the Company page instead; the copilot still reads
// the knowledge base during their calls (RLS lets every signed-in user select
// it). Writes are enforced by RLS and the server actions.
export default async function KnowledgePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const isAdmin = await isAdminInDb(createAdminClient(), user.id)
  if (!isAdmin) redirect("/company")

  const { data } = await (supabase.from("knowledge_base") as any)
    .select("id, title, content, kind, updated_at")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })

  return (
    <div className="p-3 sm:p-6 max-w-3xl mx-auto">
      <KnowledgeClient items={(data ?? []) as KbItem[]} isAdmin={isAdmin} />
    </div>
  )
}
