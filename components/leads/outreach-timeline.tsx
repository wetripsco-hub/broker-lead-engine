import { Mail, Phone, MessageSquare, ArrowUpRight, ArrowDownLeft, Voicemail } from "lucide-react"
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
}

interface OutreachTimelineProps {
  events: TimelineEvent[]
}

const CHANNEL_ICON: Record<OutreachChannel, React.ElementType> = {
  email: Mail,
  call:  Phone,
  sms:   MessageSquare,
}

const CHANNEL_LABEL: Record<OutreachChannel, string> = {
  email: "Email",
  call:  "Call",
  sms:   "SMS",
}

const STATUS_COLOR: Record<OutreachStatus, string> = {
  pending:   "text-muted-foreground",
  sent:      "text-blue-600 dark:text-blue-400",
  delivered: "text-green-600 dark:text-green-400",
  failed:    "text-destructive",
  no_answer: "text-yellow-600 dark:text-yellow-400",
  answered:  "text-green-600 dark:text-green-400",
}

const STATUS_LABEL: Record<OutreachStatus, string> = {
  pending:   "Pending",
  sent:      "Sent",
  delivered: "Delivered",
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
                    {/* Direction arrow */}
                    {ev.channel !== "email" && (
                      isInbound
                        ? <ArrowDownLeft className="size-3 text-blue-500" />
                        : <ArrowUpRight className="size-3 text-muted-foreground" />
                    )}
                    <span className={`text-xs ${STATUS_COLOR[ev.status]}`}>
                      {STATUS_LABEL[ev.status]}
                    </span>
                  </div>

                  {/* Preview */}
                  {ev.channel === "call" ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {duration && <span>Duration: {duration}</span>}
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
                  ) : ev.message_body ? (
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {ev.message_body}
                    </p>
                  ) : null}

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
