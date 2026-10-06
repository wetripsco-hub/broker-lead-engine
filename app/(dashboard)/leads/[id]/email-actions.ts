"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { interpolate } from "@/lib/email/resend"
import { sendEmail, fromAddress, conversationProvider } from "@/lib/email/send"
import { generateMessageId, replyToAddress } from "@/lib/email/message-id"
import { buildTrackedEmailHtml } from "@/lib/email/tracking"
import { followUpSubject } from "@/lib/follow-up/compute"

export interface SendEmailResult {
  error: string | null
  messageId?: string
}

export async function sendTemplateEmail(
  leadId: string,
  templateId: string,
  opts: { asFollowUp?: boolean } = {}
): Promise<SendEmailResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  // Fetch agent row
  const { data: agentRow } = await supabase
    .from("agents")
    .select("id, name")
    .eq("user_id", user.id)
    .maybeSingle()
  const agent = agentRow as { id: string; name: string } | null
  if (!agent) return { error: "No agent record for this user" }

  // Fetch lead + broker
  type LeadWithBroker = {
    id: string
    broker_id: string
    brokers: {
      company_name: string
      contact_name: string | null
      email: string | null
      mc_number: string | null
      state: string | null
      city: string | null
    } | null
  }
  const { data: leadRaw } = await supabase
    .from("leads")
    .select("id, broker_id, brokers ( company_name, contact_name, email, mc_number, state, city )")
    .eq("id", leadId)
    .maybeSingle()
  const lead = leadRaw as unknown as LeadWithBroker | null
  if (!lead) return { error: "Lead not found" }
  if (!lead.brokers?.email) return { error: "Broker has no email address" }

  // Fetch template
  type Template = { subject: string; body: string }
  const { data: tplRaw } = await supabase
    .from("email_templates")
    .select("subject, body")
    .eq("id", templateId)
    .maybeSingle()
  const tpl = tplRaw as unknown as Template | null
  if (!tpl) return { error: "Template not found" }

  // Interpolate merge tags
  const vars: Record<string, string> = {
    company_name: lead.brokers.company_name,
    contact_name: lead.brokers.contact_name ?? lead.brokers.company_name,
    // A null here would leave a literal "{{mc_number}}" in the sent email.
    mc_number:    lead.brokers.mc_number ?? "",
    state:        lead.brokers.state ?? "",
    city:         lead.brokers.city ?? "",
    agent_name:   agent.name,
  }
  let subject = interpolate(tpl.subject, vars)
  const body    = interpolate(tpl.body, vars)

  // A follow-up continues the thread: "Re: <previous subject>", with
  // In-Reply-To / References pointing at the email it follows up on.
  type Parent = { subject: string | null; message_id: string | null; email_references: string | null }
  let parent = null as Parent | null
  if (opts.asFollowUp) {
    const { data: parentRaw } = await supabase
      .from("outreach_events")
      .select("subject, message_id, email_references")
      .eq("lead_id", leadId)
      .eq("channel", "email")
      .eq("direction", "outbound")
      .not("status", "in", "(failed,pending)")
      .order("occurred_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    parent = parentRaw as unknown as Parent | null
    if (parent?.subject) subject = followUpSubject(parent.subject)
  }
  const provider = parent?.message_id ? conversationProvider() : undefined
  const references = parent
    ? [parent.email_references, parent.message_id].filter(Boolean).join(" ") || undefined
    : undefined

  // Insert the row before sending — the tracking pixel and click-wrapped
  // links embedded in the email need this row's id to report back to, and
  // the Message-ID has to be saved so a reply's In-Reply-To can find it.
  const from = fromAddress(provider)
  const rfcMessageId = generateMessageId(from)

  const { data: eventRow, error: insertError } = await (supabase.from("outreach_events") as any)
    .insert({
      lead_id:      leadId,
      agent_id:     agent.id,
      channel:      "email",
      direction:    "outbound",
      status:       "pending",
      subject,
      message_body: body,
      from_email:   from,
      to_email:     lead.brokers.email.toLowerCase(),
      message_id:   rfcMessageId,
      in_reply_to:  parent?.message_id ?? null,
      email_references: references ?? null,
    })
    .select("id")
    .single()

  if (insertError) return { error: insertError.message }
  const eventId = (eventRow as { id: string }).id

  const { id: providerId, error: sendError } = await sendEmail({
    to: lead.brokers.email,
    subject,
    text: body,
    html: buildTrackedEmailHtml(body, eventId),
    messageId: rfcMessageId,
    replyTo: replyToAddress(),
    inReplyTo: parent?.message_id ?? undefined,
    references,
    provider,
  })

  await (supabase.from("outreach_events") as any)
    .update({
      status:      sendError ? "failed" : "sent",
      external_id: providerId,
      send_error:  sendError,
    })
    .eq("id", eventId)

  if (sendError) return { error: sendError }

  revalidatePath(`/leads/${leadId}`)
  revalidatePath("/leads")
  revalidatePath("/emails")
  return { error: null, messageId: providerId ?? undefined }
}
