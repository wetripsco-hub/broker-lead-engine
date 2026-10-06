import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { KnowledgeClient, type KbItem } from "./knowledge-client"

// Everyone signed in can read the knowledge base (it's what the copilot
// answers from); only admins get the editor. Writes are enforced by RLS and
// the server actions, not by this page.
export default async function KnowledgePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const isAdmin = user.user_metadata?.role === "admin"

  const { data } = await (supabase.from("knowledge_base") as any)
    .select("id, title, content, kind, updated_at")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <KnowledgeClient items={(data ?? []) as KbItem[]} isAdmin={isAdmin} />
    </div>
  )
}
