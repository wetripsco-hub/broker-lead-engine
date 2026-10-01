import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { imapConfigured } from "@/lib/email/imap-sync"
import { EmailsClient } from "./emails-client"

export default async function EmailsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const isAdmin = user.user_metadata?.role === "admin"

  // RLS decides what's returned: an agent only gets email for leads assigned
  // to them; admins also get unmatched mail (lead_id null).
  const { data } = await supabase
    .from("outreach_events")
    .select(`
      id, lead_id, direction, status, subject, message_body, from_email, to_email,
      message_id, send_error, read_at, occurred_at,
      leads ( id, brokers ( company_name, contact_name ) )
    `)
    .eq("channel", "email")
    .order("occurred_at", { ascending: true })

  let lastSyncedAt: string | null = null
  let lastSyncError: string | null = null
  if (isAdmin) {
    const { data: stateRaw } = await (supabase.from("email_sync_state") as any)
      .select("last_synced_at, last_error")
      .eq("id", "inbox")
      .maybeSingle()
    const state = stateRaw as { last_synced_at: string | null; last_error: string | null } | null
    lastSyncedAt = state?.last_synced_at ?? null
    lastSyncError = state?.last_error ?? null
  }

  return (
    <div className="h-[calc(100vh-3rem)]">
      <EmailsClient
        initialEvents={(data ?? []) as any[]}
        isAdmin={isAdmin}
        imapConfigured={imapConfigured()}
        lastSyncedAt={lastSyncedAt}
        lastSyncError={lastSyncError}
      />
    </div>
  )
}
