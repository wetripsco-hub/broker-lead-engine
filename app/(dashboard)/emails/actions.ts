"use server"

import { createHash } from "crypto"
import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { sendEmail, fromAddress, conversationProvider } from "@/lib/email/send"
import { generateMessageId, replyToAddress } from "@/lib/email/message-id"
import { syncInbox, imapConfigured } from "@/lib/email/imap-sync"

// Reply to an email thread from the platform. Everything about *who* it goes
// to and which message it answers is derived server-side from the parent
// event (which RLS only lets the caller read if it's their lead) — the client
// supplies just the parent id and the text, so an agent can't use this to
// email arbitrary addresses from the company mailbox.
export async function sendEmailReply(
  parentEventId: string,
  body: string,
): Promise<{ error: string | null }> {
  if (!body.trim()) return { error: "Message cannot be empty" }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  const { data: agentRow } = await (supabase.from("agents") as any)
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle()
  if (!agentRow) return { error: "No agent record for this user" }
  const agentId = (agentRow as { id: string }).id

  const { data: parentRaw } = await (supabase.from("outreach_events") as any)
    .select("id, lead_id, direction, subject, from_email, to_email, message_id, email_references")
    .eq("id", parentEventId)
    .eq("channel", "email")
    .maybeSingle()
  const parent = parentRaw as {
    id: string
    lead_id: string | null
    direction: "inbound" | "outbound"
    subject: string | null
    from_email: string | null
    to_email: string | null
    message_id: string | null
    email_references: string | null
  } | null
  if (!parent) return { error: "Original email not found" }

  const toEmail = parent.direction === "inbound" ? parent.from_email : parent.to_email
  if (!toEmail) return { error: "No recipient address on the original email" }

  const baseSubject = parent.subject?.trim() || "(no subject)"
  const subject = /^re:/i.test(baseSubject) ? baseSubject : `Re: ${baseSubject}`

  const provider = conversationProvider()
  const from = fromAddress(provider)
  const rfcMessageId = generateMessageId(from)
  const references = [parent.email_references, parent.message_id].filter(Boolean).join(" ") || undefined

  const { data: eventRow, error: insertError } = await (supabase.from("outreach_events") as any)
    .insert({
      lead_id: parent.lead_id,
      agent_id: agentId,
      channel: "email",
      direction: "outbound",
      status: "pending",
      subject,
      message_body: body.trim(),
      from_email: from,
      to_email: toEmail.toLowerCase(),
      message_id: rfcMessageId,
      in_reply_to: parent.message_id,
      email_references: references ?? null,
    })
    .select("id")
    .single()
  if (insertError) return { error: insertError.message }
  const eventId = (eventRow as { id: string }).id

  const { id: providerId, error: sendError } = await sendEmail({
    to: toEmail,
    subject,
    text: body.trim(),
    messageId: rfcMessageId,
    replyTo: replyToAddress(),
    inReplyTo: parent.message_id ?? undefined,
    references,
    provider,
  })

  await (supabase.from("outreach_events") as any)
    .update({ status: sendError ? "failed" : "sent", external_id: providerId, send_error: sendError })
    .eq("id", eventId)

  revalidatePath("/emails")
  if (parent.lead_id) revalidatePath(`/leads/${parent.lead_id}`)
  return { error: sendError }
}

export async function markEmailsRead(eventIds: string[]): Promise<{ error: string | null }> {
  if (eventIds.length === 0) return { error: null }
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  const { error } = await (supabase.from("outreach_events") as any)
    .update({ read_at: new Date().toISOString() })
    .in("id", eventIds)
    .eq("channel", "email")
    .eq("direction", "inbound")
    .is("read_at", null)

  if (error) return { error: error.message }
  revalidatePath("/emails")
  return { error: null }
}

// Promote an unmatched sender to a lead (admin only — unmatched mail is only
// visible to admins anyway). Brokers require an MC number, so mint a
// placeholder one the admin can correct on the lead page, then move the
// sender's existing unmatched mail onto the new lead.
export async function addSenderAsLead(
  email: string,
  displayName: string | null,
): Promise<{ error: string | null; leadId?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || user.user_metadata?.role !== "admin") return { error: "Admin access required" }

  const addr = email.trim().toLowerCase()
  if (!addr) return { error: "No sender address" }

  const admin = createAdminClient()

  let leadId: string | null =
    ((await (admin as any).rpc("find_lead_for_email", { addr })).data as string | null) ?? null

  if (!leadId) {
    const mc = `EML-${createHash("sha1").update(addr).digest("hex").slice(0, 10)}`
    const { data: broker, error: brokerError } = await (admin.from("brokers") as any)
      .insert({
        mc_number: mc,
        company_name: displayName?.trim() || `Unknown (${addr})`,
        contact_name: displayName?.trim() || null,
        email: addr,
      })
      .select("id")
      .single()
    if (brokerError) return { error: brokerError.message }

    const { data: lead } = await (admin.from("leads") as any)
      .select("id")
      .eq("broker_id", (broker as { id: string }).id)
      .maybeSingle()
    leadId = (lead as { id: string } | null)?.id ?? null
  }
  if (!leadId) return { error: "Lead was not auto-created for this broker" }

  for (const col of ["from_email", "to_email"] as const) {
    await (admin.from("outreach_events") as any)
      .update({ lead_id: leadId })
      .eq("channel", "email")
      .is("lead_id", null)
      .eq(col, addr)
  }

  revalidatePath("/emails")
  revalidatePath("/leads")
  return { error: null, leadId }
}

// A shared inbox sync is safe for agents to trigger: it just imports mail
// server-side with the admin client, and what each user then *sees* is still
// decided by RLS (an agent only gets replies for their own leads). Agents
// get two guard rails admins don't: a short throttle so repeated clicks
// can't hammer the mailbox, and generic error text so IMAP connection
// details never reach them.
const AGENT_SYNC_COOLDOWN_MS = 15_000

export async function syncEmailNow(): Promise<{
  error: string | null
  imported?: number
  duplicates?: number
  remaining?: number
  baselined?: boolean
  throttled?: boolean
}> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  const isAdmin = user.user_metadata?.role === "admin"

  if (!isAdmin) {
    const { data: agentRow } = await (supabase.from("agents") as any)
      .select("active")
      .eq("user_id", user.id)
      .maybeSingle()
    if (!agentRow || !(agentRow as { active: boolean }).active) return { error: "No active agent record" }

    const { data: stateRaw } = await (createAdminClient().from("email_sync_state") as any)
      .select("last_synced_at")
      .eq("id", "inbox")
      .maybeSingle()
    const last = (stateRaw as { last_synced_at: string | null } | null)?.last_synced_at
    if (last && Date.now() - new Date(last).getTime() < AGENT_SYNC_COOLDOWN_MS) {
      return { error: null, imported: 0, duplicates: 0, remaining: 0, throttled: true }
    }
  }

  if (!imapConfigured()) {
    return {
      error: isAdmin
        ? "IMAP isn't configured (set IMAP_HOST, IMAP_USER, IMAP_PASS)"
        : "Email sync isn't set up yet — ask an admin.",
    }
  }

  try {
    const r = await syncInbox()
    revalidatePath("/emails")
    return { error: null, imported: r.imported, duplicates: r.duplicates, remaining: r.remaining, baselined: r.baselined }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (isAdmin) return { error: message }
    console.error("[email sync] agent-triggered sync failed:", message)
    return { error: "Sync failed — ask an admin to check the mail connection." }
  }
}
