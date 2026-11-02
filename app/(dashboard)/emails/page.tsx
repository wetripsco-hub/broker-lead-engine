import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { imapConfigured } from "@/lib/email/imap-sync"
import { fetchAll } from "@/lib/supabase/fetch-all"
import { EmailsClient } from "./emails-client"
import { isAdminInDb } from "@/lib/voice-agents/admin-check"
import { maskEmailEventsForAgent } from "./mask-events"

export default async function EmailsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const isAdmin = await isAdminInDb(createAdminClient(), user.id)

  // RLS decides what's returned: an agent only gets email for leads assigned
  // to them; admins also get unmatched mail (lead_id null).
  const data = await fetchAll<any>(() =>
    supabase
      .from("outreach_events")
      .select(`
      id, lead_id, direction, status, subject, message_body, from_email, to_email,
      message_id, send_error, read_at, occurred_at,
      leads ( id, brokers ( company_name, contact_name ) )
    `)
      .eq("channel", "email")
      .order("occurred_at", { ascending: true })
      .order("id", { ascending: true }),
  )

  // email_sync_state is admin-only under RLS (its error text can contain
  // mail-server details), so read it with the admin client and hand agents
  // just the timestamp — never the error.
  const { data: stateRaw } = await (createAdminClient().from("email_sync_state") as any)
    .select("last_synced_at, last_error")
    .eq("id", "inbox")
    .maybeSingle()
  const state = stateRaw as { last_synced_at: string | null; last_error: string | null } | null
  const lastSyncedAt = state?.last_synced_at ?? null
  const lastSyncError = isAdmin ? (state?.last_error ?? null) : null

  return (
    <div className="h-[calc(100vh-3rem)]">
      <EmailsClient
        // Agents never get a broker's full address: masked here, on the server.
        initialEvents={isAdmin ? ((data ?? []) as any[]) : maskEmailEventsForAgent((data ?? []) as any[])}
        isAdmin={isAdmin}
        imapConfigured={imapConfigured()}
        lastSyncedAt={lastSyncedAt}
        lastSyncError={lastSyncError}
      />
    </div>
  )
}
