import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { MessagesClient } from "./messages-client"

export default async function MessagesPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data } = await supabase
    .from("outreach_events")
    .select(`
      id, lead_id, direction, message_body, status, occurred_at,
      from_number, to_number, read_at,
      leads ( id, brokers ( company_name, contact_name, phone ) )
    `)
    .eq("channel", "sms")
    .order("occurred_at", { ascending: true })

  const events = (data ?? []) as any[]

  return (
    <div className="h-[calc(100vh-3rem)]">
      <MessagesClient initialEvents={events} />
    </div>
  )
}
