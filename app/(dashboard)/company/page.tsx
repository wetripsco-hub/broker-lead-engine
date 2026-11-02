import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isAdminInDb } from "@/lib/voice-agents/admin-check"
import { CompanyClient } from "./company-client"

// Company information for the sales team. Everyone signed in can read it;
// only the admin gets the editor (the save action and RLS check that too).
export default async function CompanyPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const [{ data }, isAdmin] = await Promise.all([
    (supabase.from("company_info") as any).select("body, updated_at").eq("id", 1).maybeSingle(),
    isAdminInDb(createAdminClient(), user.id),
  ])
  const row = data as { body: string; updated_at: string } | null

  return (
    <div className="p-3 sm:p-6 max-w-3xl mx-auto">
      <CompanyClient body={row?.body ?? ""} updatedAt={row?.updated_at ?? null} isAdmin={isAdmin} />
    </div>
  )
}
