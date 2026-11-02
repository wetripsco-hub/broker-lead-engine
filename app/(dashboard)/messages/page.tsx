import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isAdminInDb } from "@/lib/voice-agents/admin-check"
import { MessagesClient } from "./messages-client"
import { SMS_INBOX_SELECT, maskSmsEventsForAgent } from "./mask-events"

export default async function MessagesPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const [{ data }, isAdmin] = await Promise.all([
    (supabase.from("outreach_events") as any).select(SMS_INBOX_SELECT).eq("channel", "sms").order("occurred_at", { ascending: true }),
    isAdminInDb(createAdminClient(), user.id),
  ])

  // Agents never get a full number: masked here, on the server.
  const events = isAdmin ? ((data ?? []) as any[]) : maskSmsEventsForAgent((data ?? []) as any[])

  return (
    <div className="h-[calc(100vh-3rem)]">
      <MessagesClient initialEvents={events} isAdmin={isAdmin} />
    </div>
  )
}
