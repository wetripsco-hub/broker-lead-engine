import { Mail, Phone, MessageSquare, ArrowUpRight, ArrowDownLeft, Voicemail, Bot } from "lucide-react"
import type { OutreachChannel, OutreachStatus } from "@/types/database"

interface TimelineEvent {
  id: string
  channel: OutreachChannel
  status: OutreachStatus
  direction: "inbound" | "outbound"
  message_body: string | null
  recording_url: string | null
  occurred_at: string
  agents: { name: string } | null
  opened_at?: string | null
  open_count?: number
  clicked_at?: string | null
  click_count?: number
  subject?: string | null
  from_email?: string | null
  transcript?: string | null
  ai_summary?: string | null
  follow_up_date?: string | null
  call_status?: string | null
  sentiment?: string | null
  disposition?: string | null
  duration_seconds?: number | null
  cost_usd?: number | null
  ai_callback_time?: string | null
}

interface OutreachTimelineProps {
  events: TimelineEvent[]
}

const CHANNEL_ICON: Record<OutreachChannel, React.ElementType> = {
  email: Mail,
  call:  Phone,
  sms:   MessageSquare,
  ai_call: Bot,
}

const CHANNEL_LABEL: Record<OutreachChannel, string> = {
  email: "Email",
  call:  "Call",
  sms:   "SMS",
  ai_call: "AI call",
}

// Sent (gray) -> Delivered (blue) -> Opened (green) -> Clicked (purple)
const STATUS_BADGE: Record<OutreachStatus, string> = {
  pending:   "bg-muted text-muted-foreground",
  sent:      "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200",
  delivered: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  opened:    "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  clicked:   "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  failed:    "bg-destructive/10 text-destructive",
  no_answer: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300",
  answered:  "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
}

const STATUS_LABEL: Record<OutreachStatus, string> = {
  pending:   "Pending",
  sent:      "Sent",
  delivered: "Delivered",
  opened:    "Opened",
  clicked:   "Clicked",
  failed:    "Failed",
  no_answer: "No answer",
  answered:  "Answered",
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
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()

  if (isSameDay(d, today)) return "Today"
  if (isSameDay(d, yesterday)) return "Yesterday"
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
}

// Group events by calendar day (newest first within each day, groups newest first)
function groupByDay(events: TimelineEvent[]): Array<{ label: string; events: TimelineEvent[] }> {
  const map = new Map<string, TimelineEvent[]>()
  for (const ev of events) {
    const key = new Date(ev.occurred_at).toDateString()
    const bucket = map.get(key) ?? []
    bucket.push(ev)
    map.set(key, bucket)
  }
  return Array.from(map.entries()).map(([, evs]) => ({
    label: dayLabel(evs[0].occurred_at),
    events: evs,
  }))
}

// A reply carries the whole quoted thread below the new text; the timeline
// preview only wants the new part. Display only — the full text is stored.
function withoutQuotedReply(text: string): string {
  const cuts = [
    text.search(/\r?\n?On [\s\S]{0,300}?wrote:/),
    text.search(/\r?\n-{2,}\s*Original Message/i),
    text.search(/(^|\n)>/),
  ].filter((i) => i >= 0)
  if (cuts.length === 0) return text
  return text.slice(0, Math.min(...cuts)).trim() || text
}

// Parse "Duration: Xs" from message_body written by logCallEnded
function parseDuration(body: string | null): string | null {
  if (!body) return null
  const m = body.match(/Duration:\s*(\d+)s/)
  if (!m) return null
  const s = parseInt(m[1], 10)
  const mins = Math.floor(s / 60)
  const secs = s % 60
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
}

const AI_CALL_STATUS_LABEL: Record<string, string> = {
  queued: "Calling",
  registered: "Calling",
  in_progress: "In progress",
  ended: "Ended",
  failed: "Failed",
}

const SENTIMENT_BADGE: Record<string, string> = {
  positive: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  neutral: "bg-muted text-muted-foreground",
  negative: "bg-destructive/10 text-destructive",
}

function AiCallDetails({ ev }: { ev: TimelineEvent }) {
  const mins = ev.duration_seconds != null ? Math.floor(ev.duration_seconds / 60) : null
  const secs = ev.duration_seconds != null ? ev.duration_seconds % 60 : null
  return (
    <div className="space-y-1.5 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {mins != null && secs != null && <span>Duration: {mins > 0 ? `${mins}m ${secs}s` : `${secs}s`}</span>}
        {ev.cost_usd != null && <span className="tabular-nums">Cost: ${Number(ev.cost_usd).toFixed(2)}</span>}
        {ev.sentiment && (
          <span className={`rounded-full px-1.5 py-0.5 font-medium capitalize ${SENTIMENT_BADGE[ev.sentiment.toLowerCase()] ?? SENTIMENT_BADGE.neutral}`}>
            {ev.sentiment}
          </span>
        )}
      </div>
      {ev.ai_summary && <p>{ev.ai_summary}</p>}
      {ev.call_status === "ended" && ev.status === "no_answer" && !ev.transcript && !ev.ai_summary && (
        <p>Nobody spoke on this call (not picked up, voicemail, or no audio). The AI did not get to talk.</p>
      )}
      {(ev.follow_up_date || ev.ai_callback_time) && (
        <p className="rounded-md bg-amber-500/10 px-2 py-1 text-amber-800 dark:text-amber-300">
          Suggested follow-up: {ev.follow_up_date ?? ev.ai_callback_time}
          {ev.follow_up_date && ev.ai_callback_time ? ` (“${ev.ai_callback_time}”)` : ""}
        </p>
      )}
      {ev.recording_url && <audio controls preload="none" src={ev.recording_url} className="h-8 w-full max-w-sm" />}
      {ev.transcript && (
        <details>
          <summary className="cursor-pointer select-none text-blue-600 hover:underline dark:text-blue-400">Transcript</summary>
          <pre className="mt-1.5 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/40 p-2.5 font-sans leading-relaxed">
            {ev.transcript}
          </pre>
        </details>
      )}
    </div>
  )
}

export function OutreachTimeline({ events }: OutreachTimelineProps) {
  if (events.length === 0) {
    return (
      <div className="rounded-lg border bg-card py-10 flex flex-col items-center gap-2.5 text-center animate-in-fade">
        <div className="size-10 rounded-full bg-muted flex items-center justify-center">
          <Phone className="size-4 text-muted-foreground/60" />
        </div>
        <p className="text-sm text-muted-foreground">
          No outreach yet. Use the buttons above to log the first contact.
        </p>
      </div>
    )
  }

  const groups = groupByDay(events)
  let rowIndex = 0

  return (
    <div className="rounded-lg border bg-card shadow-sm divide-y overflow-hidden">
      {groups.map((group) => (
        <div key={group.label}>
          {/* Day separator */}
          <div className="px-4 py-2 bg-muted/40 flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">{group.label}</span>
          </div>

          {group.events.map((ev) => {
            const Icon = CHANNEL_ICON[ev.channel]
            const isInbound = ev.direction === "inbound"
            const duration = ev.channel === "call" ? parseDuration(ev.message_body) : null
            const delay = Math.min(rowIndex++ * 40, 320)

            return (
              <div
                key={ev.id}
                className="flex items-start gap-3 px-4 py-3 text-sm border-t first:border-t-0 transition-colors duration-150 ease-[var(--ease-out)] hover:bg-muted/30 animate-in-rise"
                style={{ animationDelay: `${delay}ms` }}
              >
                {/* Channel icon */}
                <div className="mt-0.5 shrink-0 size-7 rounded-full bg-muted flex items-center justify-center">
                  <Icon className="size-3.5 text-muted-foreground" />
                </div>

                {/* Body */}
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-medium">{CHANNEL_LABEL[ev.channel]}</span>
                    {/* Direction arrow — outbound email is the default case, so
                        only inbound email (a broker's reply) gets one */}
                    {(ev.channel !== "email" || isInbound) && (
                      isInbound
                        ? <ArrowDownLeft className="size-3 text-blue-500" />
                        : <ArrowUpRight className="size-3 text-muted-foreground" />
                    )}
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${STATUS_BADGE[ev.status]}`}>
                      {ev.channel === "email" && isInbound
                        ? "Received"
                        : ev.channel === "ai_call"
                          ? ev.call_status === "ended"
                            ? STATUS_LABEL[ev.status] // finished: show the outcome (Answered / No answer / Failed)
                            : AI_CALL_STATUS_LABEL[ev.call_status ?? ""] ?? STATUS_LABEL[ev.status]
                          : STATUS_LABEL[ev.status]}
                    </span>
                  </div>

                  {/* Preview */}
                  {ev.channel === "ai_call" ? (
                    <AiCallDetails ev={ev} />
                  ) : ev.channel === "call" ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {duration && <span>Duration: {duration}</span>}
                      {ev.follow_up_date && <span>Follow up: {ev.follow_up_date}</span>}
                      {ev.recording_url && (
                        <a
                          href={ev.recording_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-0.5 text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          <Voicemail className="size-3" />
                          Recording
                        </a>
                      )}
                    </div>
                  ) : (
                    <>
                      {ev.channel === "email" && ev.subject && (
                        <p className="text-xs font-medium">{ev.subject}</p>
                      )}
                      {ev.message_body && (
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {ev.channel === "email" && isInbound ? withoutQuotedReply(ev.message_body) : ev.message_body}
                        </p>
                      )}
                    </>
                  )}

                  {ev.channel === "call" && ev.ai_summary && (
                    <p className="text-xs text-muted-foreground">{ev.ai_summary}</p>
                  )}
                  {ev.channel === "call" && ev.transcript && (
                    <details className="text-xs">
                      <summary className="cursor-pointer select-none text-blue-600 hover:underline dark:text-blue-400">
                        Transcript
                      </summary>
                      <pre className="mt-1.5 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/40 p-2.5 font-sans leading-relaxed text-muted-foreground">
                        {ev.transcript}
                      </pre>
                    </details>
                  )}

                  {/* Open/click stats — email only */}
                  {ev.channel === "email" && ((ev.open_count ?? 0) > 0 || (ev.click_count ?? 0) > 0) && (
                    <p className="text-xs text-muted-foreground">
                      {(ev.open_count ?? 0) > 0 && (
                        <>
                          Opened {ev.open_count} time{ev.open_count === 1 ? "" : "s"}
                          {ev.opened_at && ` · last ${relativeTime(ev.opened_at)}`}
                        </>
                      )}
                      {(ev.click_count ?? 0) > 0 && (
                        <>
                          {(ev.open_count ?? 0) > 0 && " · "}
                          Clicked {ev.click_count} time{ev.click_count === 1 ? "" : "s"}
                        </>
                      )}
                    </p>
                  )}

                  <p className="text-xs text-muted-foreground">
                    {isInbound ? "Broker" : (ev.agents?.name ?? "Agent")}
                    {" · "}
                    {relativeTime(ev.occurred_at)}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
