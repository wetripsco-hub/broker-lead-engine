import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { StageSelector } from "@/components/leads/stage-selector"
import { StageBadge } from "@/components/leads/stage-badge"
import { NotesEditor } from "@/components/leads/notes-editor"
import { EmailCompose } from "@/components/leads/email-compose"
import { CallButton } from "@/components/leads/call-button"
import { SmsThread } from "@/components/leads/sms-thread"
import { OutreachTimeline } from "@/components/leads/outreach-timeline"
import { ArrowLeft, Mail, Phone, MapPin, Calendar, Hash } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import type { LeadStage } from "@/types/database"

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType
  label: string
  value: string | null | undefined
}) {
  if (!value) return null
  return (
    <div className="flex items-start gap-2.5 text-sm">
      <Icon className="size-3.5 mt-0.5 text-muted-foreground shrink-0" />
      <div>
        <span className="text-muted-foreground text-xs">{label} </span>
        <span>{value}</span>
      </div>
    </div>
  )
}

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const isAdmin = user.user_metadata?.role === "admin"

  type LeadDetail = {
    id: string
    stage: LeadStage
    notes: string | null
    assigned_agent_id: string | null
    created_at: string
    brokers: {
      mc_number: string | null
      dot_number: string | null
      company_name: string | null
      contact_name: string | null
      email: string | null
      phone: string | null
      address_line1: string | null
      city: string | null
      state: string | null
      zip: string | null
      authority_status: string | null
      registration_date: string | null
    } | null
    agents: { id: string; name: string } | null
  }

  const { data: leadRaw } = await supabase
    .from("leads")
    .select(`
      id, stage, notes, assigned_agent_id, created_at,
      brokers (
        mc_number, dot_number, company_name, contact_name, email, phone,
        address_line1, city, state, zip, authority_status, registration_date
      ),
      agents ( id, name )
    `)
    .eq("id", id)
    .maybeSingle()

  if (!leadRaw) notFound()
  const lead = leadRaw as unknown as LeadDetail

  const b = lead.brokers
  const agent = lead.agents

  // Fetch agent record for the current user (needed for outreach logging)
  const { data: myAgentRaw } = await supabase
    .from("agents")
    .select("id, name")
    .eq("user_id", user.id)
    .maybeSingle()
  const myAgent = myAgentRaw as { id: string; name: string } | null

  // Email templates (for compose dialog)
  const { data: templatesRaw } = await supabase
    .from("email_templates")
    .select("id, name, subject, body")
    .order("created_at", { ascending: true })
  const templates = (templatesRaw ?? []) as Array<{
    id: string; name: string; subject: string; body: string
  }>

  // Outreach events for this lead (all channels for timeline; newest first)
  const { data: eventsRaw } = await supabase
    .from("outreach_events")
    .select("id, channel, status, message_body, recording_url, direction, occurred_at, agents ( name )")
    .eq("lead_id", lead.id)
    .order("occurred_at", { ascending: false })
  const events = (eventsRaw ?? []) as any[]

  // SMS events in chronological order for thread view
  const smsEvents = (eventsRaw ?? [])
    .filter((e: any) => e.channel === "sms")
    .reverse() as Array<{
    id: string
    direction: "inbound" | "outbound"
    message_body: string | null
    status: string
    occurred_at: string
    agents: { name: string } | null
  }>

  const mergeVars = {
    company_name: b?.company_name ?? "",
    contact_name: b?.contact_name ?? b?.company_name ?? "",
    mc_number:    b?.mc_number ?? "",
    state:        b?.state ?? "",
    city:         b?.city ?? "",
    agent_name:   myAgent?.name ?? "",
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Back + header */}
      <div>
        <Link
          href="/leads"
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-3"
        >
          <ArrowLeft className="size-3.5" />
          Back to leads
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {b?.company_name ?? "Unknown broker"}
            </h1>
            <p className="text-sm text-muted-foreground font-mono mt-0.5">MC-{b?.mc_number}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            <CallButton
              leadId={lead.id}
              agentId={myAgent?.id ?? ""}
              brokerPhone={b?.phone ?? null}
              brokerName={b?.company_name ?? null}
            />
            <EmailCompose
              leadId={lead.id}
              brokerEmail={b?.email ?? null}
              templates={templates}
              mergeVars={mergeVars}
            />
            {isAdmin ? (
              <StageSelector leadId={lead.id} stage={lead.stage} />
            ) : (
              <StageBadge stage={lead.stage} />
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_300px] gap-6">
        {/* Left column */}
        <div className="space-y-6">
          {/* FMCSA Profile */}
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              FMCSA Profile
            </h2>
            <div className="rounded-lg border bg-card p-4 space-y-2.5">
              <InfoRow icon={Hash}     label="MC#"        value={b?.mc_number ? `MC-${b.mc_number}` : null} />
              <InfoRow icon={Hash}     label="DOT#"       value={b?.dot_number} />
              <InfoRow icon={Phone}    label="Phone"      value={b?.phone} />
              <InfoRow icon={Mail}     label="Email"      value={b?.email} />
              <InfoRow
                icon={MapPin}
                label="Address"
                value={[b?.address_line1, b?.city, b?.state, b?.zip].filter(Boolean).join(", ") || null}
              />
              <InfoRow icon={Calendar} label="Registered" value={b?.registration_date} />
              {b?.authority_status && (
                <div className="flex items-center gap-2 pt-1">
                  <Badge variant="outline" className="text-xs">
                    {b.authority_status}
                  </Badge>
                </div>
              )}
            </div>
          </section>

          {/* Outreach timeline */}
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              Outreach Timeline
            </h2>
            <OutreachTimeline events={events} />
          </section>

          {/* SMS Thread */}
          <SmsThread
            leadId={lead.id}
            brokerPhone={b?.phone ?? null}
            brokerName={b?.company_name ?? null}
            initialEvents={smsEvents}
          />
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Assignment */}
          <div className="rounded-lg border bg-card p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Assigned to
            </p>
            <p className="text-sm">
              {agent?.name ?? (
                <span className="italic text-muted-foreground">Unassigned</span>
              )}
            </p>
          </div>

          {/* Notes */}
          <div className="rounded-lg border bg-card p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Notes
            </p>
            <NotesEditor leadId={lead.id} initialNotes={lead.notes} />
          </div>

          {/* Meta */}
          <div className="rounded-lg border bg-card p-4 text-xs text-muted-foreground space-y-1">
            <p>Lead created: {new Date(lead.created_at).toLocaleDateString()}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
