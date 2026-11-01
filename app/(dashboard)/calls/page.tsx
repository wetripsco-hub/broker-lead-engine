import Link from "next/link"
import { redirect } from "next/navigation"
import { Mic } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isAdminInDb } from "@/lib/voice-agents/admin-check"
import { Badge } from "@/components/ui/badge"
import { CallRecordingPlayer } from "@/components/calls/call-recording-player"
import { formatPhoneDisplay } from "@/lib/phone"
import { resolveTimezone } from "@/lib/timezone/broker-time"
import {
  CALLS_PER_PAGE,
  callFiltersQuery,
  callSeconds,
  formatBrokerTime,
  formatCallDuration,
  formatPktTime,
  outcomeLabel,
  parseCallFilters,
  rangeStart,
} from "@/lib/calls/review"
import { CallFiltersBar } from "./calls-filters"

interface CallRow {
  id: string
  occurred_at: string
  status: string
  disposition: string | null
  message_body: string | null
  recording_path: string | null
  recording_seconds: number | null
  transcript: string | null
  ai_summary: string | null
  direct_number: string | null
  lead_id: string | null
  agents: { name: string } | null
  leads: {
    brokers: { company_name: string | null; mc_number: string | null; state: string | null; phone: string | null } | null
  } | null
}

const STATUS_LABEL: Record<string, string> = { pending: "Pending", answered: "Answered", no_answer: "No answer", failed: "Failed" }

export default async function CallsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")
  // Server-side gate — the sidebar hides this link for agents, but that
  // alone doesn't stop a direct URL visit.
  if (!(await isAdminInDb(createAdminClient(), user.id))) redirect("/leads")

  const filters = parseCallFilters(await searchParams)
  const from = (filters.page - 1) * CALLS_PER_PAGE

  let query = (supabase.from("outreach_events") as any)
    .select(
      "id, occurred_at, status, disposition, message_body, recording_path, recording_seconds, transcript, ai_summary, direct_number, lead_id, agents ( name ), leads ( brokers ( company_name, mc_number, state, phone ) )",
      { count: "exact" },
    )
    .eq("channel", "call")
    .order("occurred_at", { ascending: false })
    .range(from, from + CALLS_PER_PAGE - 1)

  const start = rangeStart(filters.range, new Date())
  if (start) query = query.gte("occurred_at", start.toISOString())
  if (filters.agent) query = query.eq("agent_id", filters.agent)
  if (filters.outcome) query = query.eq("disposition", filters.outcome)
  if (filters.recording) query = query.not("recording_path", "is", null)

  const [{ data: callsRaw, count, error }, { data: agentsRaw }] = await Promise.all([
    query,
    supabase.from("agents").select("id, name").order("name", { ascending: true }),
  ])
  const calls = (callsRaw ?? []) as CallRow[]
  const agents = (agentsRaw ?? []) as Array<{ id: string; name: string }>
  const total = (count as number | null) ?? 0
  const lastPage = Math.max(1, Math.ceil(total / CALLS_PER_PAGE))

  return (
    <div className="p-3 sm:p-6 max-w-6xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Call Reviews</h1>
        <p className="text-sm text-muted-foreground">
          {total} {total === 1 ? "call" : "calls"}. Listen to the recording, read the transcript, check the outcome.
        </p>
      </div>

      <CallFiltersBar filters={filters} agents={agents} />

      {error ? (
        <p className="rounded-lg border bg-card py-10 text-center text-sm text-destructive">Could not load calls: {error.message}</p>
      ) : calls.length === 0 ? (
        <p className="rounded-lg border bg-card py-10 text-center text-sm text-muted-foreground">No calls match these filters.</p>
      ) : (
        <ul className="rounded-lg border bg-card shadow-sm divide-y overflow-hidden">
          {calls.map((call) => (
            <CallItem key={call.id} call={call} />
          ))}
        </ul>
      )}

      {lastPage > 1 && (
        <nav className="flex items-center justify-between text-sm" aria-label="Pages">
          {filters.page > 1 ? (
            <Link href={`/calls${callFiltersQuery(filters, { page: filters.page - 1 })}`} className="text-blue-600 hover:underline dark:text-blue-400">
              Newer
            </Link>
          ) : <span />}
          <span className="text-muted-foreground">Page {filters.page} of {lastPage}</span>
          {filters.page < lastPage ? (
            <Link href={`/calls${callFiltersQuery(filters, { page: filters.page + 1 })}`} className="text-blue-600 hover:underline dark:text-blue-400">
              Older
            </Link>
          ) : <span />}
        </nav>
      )}
    </div>
  )
}

function CallItem({ call }: { call: CallRow }) {
  const broker = call.leads?.brokers ?? null
  const tz = resolveTimezone(broker?.state, broker?.phone ?? call.direct_number)

  return (
    <li className="space-y-2 px-4 py-3 text-sm">
      <div className="grid gap-x-4 gap-y-1 md:grid-cols-[11rem_minmax(0,1fr)_8rem_4.5rem_10rem] md:items-start">
        <div>
          <p className="tabular-nums">{formatPktTime(call.occurred_at)}</p>
          {tz && <p className="text-xs text-muted-foreground tabular-nums">Broker: {formatBrokerTime(call.occurred_at, tz.tz)}</p>}
        </div>

        <div className="min-w-0">
          {call.lead_id ? (
            <Link href={`/leads/${call.lead_id}`} className="block truncate font-medium hover:underline">
              {broker?.company_name ?? "Unknown broker"}
            </Link>
          ) : (
            <p className="truncate font-medium font-mono">{call.direct_number ? formatPhoneDisplay(call.direct_number) : "Unknown number"}</p>
          )}
          {call.lead_id && broker?.mc_number && <p className="text-xs text-muted-foreground">MC {broker.mc_number}</p>}
        </div>

        <p className="truncate text-muted-foreground">{call.agents?.name ?? "Agent"}</p>
        <p className="tabular-nums text-muted-foreground">{formatCallDuration(callSeconds(call))}</p>

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={call.disposition ? "default" : "secondary"} className="font-normal">{outcomeLabel(call.disposition)}</Badge>
          <span className="text-xs text-muted-foreground">{STATUS_LABEL[call.status] ?? call.status}</span>
        </div>
      </div>

      {call.recording_path ? (
        <CallRecordingPlayer eventId={call.id} showDownload />
      ) : (
        <p className="flex items-center gap-1 text-xs text-muted-foreground/70">
          <Mic className="size-3" />
          No recording
        </p>
      )}

      {call.ai_summary && <p className="text-xs text-muted-foreground">{call.ai_summary}</p>}
      {call.transcript && (
        <details className="text-xs">
          <summary className="cursor-pointer select-none text-blue-600 hover:underline dark:text-blue-400">Transcript</summary>
          <pre className="mt-1.5 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/40 p-2.5 font-sans leading-relaxed text-muted-foreground">
            {call.transcript}
          </pre>
        </details>
      )}
    </li>
  )
}
