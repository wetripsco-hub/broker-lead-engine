import { createHash } from "crypto"
import { simpleParser, type AddressObject } from "mailparser"
import { createAdminClient } from "@/lib/supabase/admin"
import { bareAddress } from "@/lib/email/message-id"

type Admin = ReturnType<typeof createAdminClient>

export interface InboundResult {
  outcome: "imported" | "duplicate" | "skipped"
  matchedBy?: "thread" | "sender" | null
  leadId?: string | null
  reason?: string
}

const MAX_BODY_CHARS = 200_000

function firstAddress(a: AddressObject | AddressObject[] | undefined): string | null {
  const obj = Array.isArray(a) ? a[0] : a
  const addr = obj?.value?.[0]?.address
  return addr ? addr.toLowerCase() : null
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

// Any existing agent, preferring the earliest (the admin who set the system
// up). outreach_events.agent_id is required even when a reply can't be tied
// to a lead; such rows are admin-only visible regardless of this value.
async function fallbackAgentId(admin: Admin): Promise<string | null> {
  const { data } = await (admin.from("agents") as any)
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}

// Parse one raw RFC 822 message, work out which lead (if any) it belongs to,
// and store it as an inbound email event. Throws only on database errors —
// the caller must NOT advance its sync cursor past a message that threw, or
// a transient failure would silently drop that reply forever.
export async function processInboundMessage(
  admin: Admin,
  raw: Buffer | string,
  opts: { mailboxAddress?: string } = {},
): Promise<InboundResult> {
  const parsed = await simpleParser(raw)

  const fromEmail = firstAddress(parsed.from)
  if (!fromEmail) return { outcome: "skipped", reason: "no sender address" }

  // Our own outbound copies (e.g. Sent-via-BCC landing in INBOX) aren't replies.
  const mailbox = opts.mailboxAddress ? bareAddress(opts.mailboxAddress).toLowerCase() : null
  if (mailbox && fromEmail === mailbox) return { outcome: "skipped", reason: "sent by the mailbox itself" }

  const toEmail = firstAddress(parsed.to) ?? mailbox
  const receivedAt = (parsed.date && !Number.isNaN(parsed.date.getTime()) ? parsed.date : new Date()).toISOString()

  // Dedup key. A message with no Message-ID gets a stable synthetic one so a
  // re-sync still can't import it twice.
  const messageId =
    parsed.messageId ??
    `<synthetic-${createHash("sha1").update(typeof raw === "string" ? raw : raw.toString("binary")).digest("hex")}@local>`

  const inReplyTo = parsed.inReplyTo ?? null
  const refs = Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : []

  // 1) Thread match: In-Reply-To / References point at a message we sent (or
  //    previously imported) — that event's lead is authoritative.
  let leadId: string | null = null
  let matchedBy: "thread" | "sender" | null = null
  let parentAgentId: string | null = null

  const candidateIds = [...new Set([inReplyTo, ...refs].filter((x): x is string => !!x))]
  if (candidateIds.length > 0) {
    const { data: parents } = await (admin.from("outreach_events") as any)
      .select("lead_id, agent_id")
      .eq("channel", "email")
      .in("message_id", candidateIds)
      .not("lead_id", "is", null)
      .limit(1)
    const parent = (parents as Array<{ lead_id: string; agent_id: string }> | null)?.[0]
    if (parent) {
      leadId = parent.lead_id
      parentAgentId = parent.agent_id
      matchedBy = "thread"
    }
  }

  // 2) Sender match: the address belongs to a broker or one of its officials.
  if (!leadId) {
    const { data: found } = await (admin as any).rpc("find_lead_for_email", { addr: fromEmail })
    if (found) {
      leadId = found as string
      matchedBy = "sender"
    }
  }

  // agent_id = the lead's currently assigned agent; unmatched or unassigned
  // falls back so the NOT NULL column is satisfied.
  let agentId: string | null = null
  if (leadId) {
    const { data: lead } = await (admin.from("leads") as any)
      .select("assigned_agent_id")
      .eq("id", leadId)
      .maybeSingle()
    agentId = (lead as { assigned_agent_id: string | null } | null)?.assigned_agent_id ?? parentAgentId
  }
  if (!agentId) agentId = await fallbackAgentId(admin)
  if (!agentId) return { outcome: "skipped", reason: "no agents exist" }

  const html = typeof parsed.html === "string" ? parsed.html : null
  const text = (parsed.text?.trim() || (html ? stripHtml(html) : "")).slice(0, MAX_BODY_CHARS)

  const { error } = await (admin.from("outreach_events") as any).insert({
    lead_id: leadId,
    agent_id: agentId,
    channel: "email",
    direction: "inbound",
    status: "delivered",
    subject: parsed.subject ?? "(no subject)",
    message_body: text,
    body_html: html ? html.slice(0, MAX_BODY_CHARS) : null,
    from_email: fromEmail,
    to_email: toEmail,
    message_id: messageId,
    in_reply_to: inReplyTo,
    email_references: refs.length ? refs.join(" ") : null,
    received_at: receivedAt,
    occurred_at: receivedAt,
  })

  if (error) {
    if (error.code === "23505") return { outcome: "duplicate", matchedBy, leadId }
    throw new Error(error.message)
  }

  return { outcome: "imported", matchedBy, leadId }
}
