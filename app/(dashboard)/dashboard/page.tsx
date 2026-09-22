import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Users, TrendingUp, Mail, Phone, MessageSquare, ArrowUpRight, ArrowDownLeft } from "lucide-react"
import type { UserRole, OutreachChannel } from "@/types/database"

const CHANNEL_ICON: Record<OutreachChannel, React.ElementType> = {
  email: Mail,
  call:  Phone,
  sms:   MessageSquare,
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days === 1) return "yesterday"
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const role = (user?.user_metadata?.role as UserRole) ?? "agent"

  const [
    { count: totalLeads },
    { count: convertedLeads },
    { count: totalOutreach },
    { count: thisWeekLeads },
  ] = await Promise.all([
    supabase.from("leads").select("*", { count: "exact", head: true }),
    supabase.from("leads").select("*", { count: "exact", head: true }).eq("stage", "converted"),
    supabase.from("outreach_events").select("*", { count: "exact", head: true }),
    supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .gte("created_at", new Date(Date.now() - 7 * 86400_000).toISOString()),
  ])

  const stats = [
    {
      label: "Total Leads",
      value: totalLeads ?? 0,
      icon: Users,
      sub: `+${thisWeekLeads ?? 0} this week`,
      href: "/leads",
    },
    {
      label: "Converted",
      value: convertedLeads ?? 0,
      icon: TrendingUp,
      sub: totalLeads
        ? `${((((convertedLeads ?? 0) / totalLeads) * 100) | 0)}% conversion`
        : "—",
      href: "/leads",
    },
    {
      label: "Outreach Sent",
      value: totalOutreach ?? 0,
      icon: Mail,
      sub: "Email + call + SMS",
      href: null,
    },
    {
      label: "Avg Touchpoints",
      value:
        totalLeads && totalOutreach
          ? ((totalOutreach / totalLeads) as number).toFixed(1)
          : "—",
      icon: Phone,
      sub: "Per lead",
      href: null,
    },
  ]

  // Recent activity: last 12 outreach events across all leads
  const { data: recentRaw } = await supabase
    .from("outreach_events")
    .select(`
      id, channel, status, direction, message_body, occurred_at,
      agents ( name ),
      leads ( id, brokers ( company_name, mc_number ) )
    `)
    .order("occurred_at", { ascending: false })
    .limit(12)

  const recent = (recentRaw ?? []) as Array<{
    id: string
    channel: OutreachChannel
    status: string
    direction: "inbound" | "outbound"
    message_body: string | null
    occurred_at: string
    agents: { name: string } | null
    leads: { id: string; brokers: { company_name: string | null; mc_number: string | null } | null } | null
  }>

  // Stage breakdown
  const { data: stageRaw } = await supabase
    .from("leads")
    .select("stage")

  const stageCounts = (stageRaw ?? []).reduce<Record<string, number>>((acc, r: { stage: string }) => {
    acc[r.stage] = (acc[r.stage] ?? 0) + 1
    return acc
  }, {})

  const stages: Array<{ key: string; label: string; color: string }> = [
    { key: "new",        label: "New",        color: "bg-blue-500" },
    { key: "contacted",  label: "Contacted",  color: "bg-yellow-500" },
    { key: "interested", label: "Interested", color: "bg-purple-500" },
    { key: "converted",  label: "Converted",  color: "bg-green-500" },
    { key: "dead",       label: "Dead",       color: "bg-muted-foreground" },
  ]

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {role === "admin" ? "Overview across all agents" : "Your leads at a glance"}
        </p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(({ label, value, icon: Icon, sub, href }) => {
          const card = (
            <Card className={href ? "transition-colors hover:bg-muted/50 cursor-pointer" : ""}>
              <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
                <Icon className="size-4 text-muted-foreground" aria-hidden />
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold tabular-nums">{value}</p>
                <p className="text-xs text-muted-foreground mt-1">{sub}</p>
              </CardContent>
            </Card>
          )
          return href ? (
            <Link key={label} href={href} className="block">
              {card}
            </Link>
          ) : (
            <div key={label}>{card}</div>
          )
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
        {/* Recent activity */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Recent activity</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {recent.length === 0 ? (
              <p className="px-6 pb-6 text-sm text-muted-foreground">
                No outreach events yet. Open a lead to get started.
              </p>
            ) : (
              <ul className="divide-y">
                {recent.map((ev) => {
                  const Icon = CHANNEL_ICON[ev.channel]
                  const brokerName =
                    ev.leads?.brokers?.company_name ?? `MC-${ev.leads?.brokers?.mc_number ?? "?"}`
                  const isInbound = ev.direction === "inbound"

                  return (
                    <li key={ev.id}>
                      <Link
                        href={ev.leads?.id ? `/leads/${ev.leads.id}` : "#"}
                        className="flex items-center gap-3 px-6 py-3 text-sm hover:bg-muted/50 transition-colors"
                      >
                        <div className="size-7 rounded-full bg-muted flex items-center justify-center shrink-0">
                          <Icon className="size-3.5 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1 flex-wrap">
                            <span className="font-medium truncate">{brokerName}</span>
                            {ev.channel !== "email" && (
                              isInbound
                                ? <ArrowDownLeft className="size-3 text-blue-500 shrink-0" />
                                : <ArrowUpRight className="size-3 text-muted-foreground shrink-0" />
                            )}
                          </div>
                          {ev.message_body && (
                            <p className="text-xs text-muted-foreground truncate">{ev.message_body}</p>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                          {relativeTime(ev.occurred_at)}
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Stage breakdown */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Leads by stage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {stages.map(({ key, label, color }) => {
              const count = stageCounts[key] ?? 0
              const pct = totalLeads ? Math.round((count / totalLeads) * 100) : 0
              return (
                <div key={key}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-medium tabular-nums">{count}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full ${color} transition-all`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )
            })}
            {!totalLeads && (
              <p className="text-xs text-muted-foreground">No leads yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
