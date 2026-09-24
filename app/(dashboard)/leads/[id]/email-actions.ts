"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { interpolate } from "@/lib/email/resend"
import { sendEmail } from "@/lib/email/send"

export interface SendEmailResult {
  error: string | null
  messageId?: string
}

export async function sendTemplateEmail(
  leadId: string,
  templateId: string
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
      mc_number: string
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
    mc_number:    lead.brokers.mc_number,
    state:        lead.brokers.state ?? "",
    city:         lead.brokers.city ?? "",
    agent_name:   agent.name,
  }
  const subject = interpolate(tpl.subject, vars)
  const body    = interpolate(tpl.body, vars)

  const { id: messageId, error: sendError } = await sendEmail({
    to: lead.brokers.email,
    subject,
    text: body,
  })

  // Log every attempt to outreach_events, success or failure, so the
  // timeline and any bulk-send summary reflect what actually happened.
  await (supabase.from("outreach_events") as any).insert({
    lead_id:      leadId,
    agent_id:     agent.id,
    channel:      "email",
    status:       sendError ? "failed" : "sent",
    message_body: sendError ? `Subject: ${subject}\n\nFailed: ${sendError}` : `Subject: ${subject}\n\n${body}`,
    external_id:  messageId,
  })

  if (sendError) return { error: sendError }

  revalidatePath(`/leads/${leadId}`)
  revalidatePath("/leads")
  return { error: null, messageId: messageId ?? undefined }
}
