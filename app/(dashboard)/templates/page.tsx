import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { TemplatesClient } from "./templates-client"

export default async function TemplatesPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const isAdmin = user.user_metadata?.role === "admin"

  const { data } = await supabase
    .from("email_templates")
    .select("id, name, subject, body, created_at")
    .order("created_at", { ascending: false })

  const templates = (data ?? []) as Array<{
    id: string
    name: string
    subject: string
    body: string
    created_at: string
  }>

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <TemplatesClient templates={templates} isAdmin={isAdmin} />
    </div>
  )
}
