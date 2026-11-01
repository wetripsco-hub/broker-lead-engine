// Filters and display helpers for the admin Call Reviews page (/calls).

import { AGENT_TZ, AGENT_TZ_ABBR } from "@/lib/timezone/broker-time"
import { DISPOSITION_LABEL, type DispositionKey } from "@/lib/call-dispositions"

export const CALLS_PER_PAGE = 50

export type CallRange = "today" | "week" | "all"

export interface CallFilters {
  agent: string | null
  range: CallRange
  outcome: DispositionKey | null
  recording: boolean
  page: number
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PKT_OFFSET_MS = 5 * 3_600_000 // Pakistan has no daylight saving
const DAY_MS = 86_400_000

type Params = Record<string, string | string[] | undefined>

/** Unknown values fall back to "no filter", so a hand-edited URL can't break the query. */
export function parseCallFilters(params: Params): CallFilters {
  const one = (key: string) => {
    const v = params[key]
    return typeof v === "string" ? v : null
  }
  const agent = one("agent")
  const range = one("range")
  const outcome = one("outcome")
  const page = Number(one("page"))
  return {
    agent: agent && UUID.test(agent) ? agent : null,
    range: range === "today" || range === "week" ? range : "all",
    outcome: outcome && outcome in DISPOSITION_LABEL ? (outcome as DispositionKey) : null,
    recording: one("recording") === "yes",
    page: Number.isInteger(page) && page > 0 ? page : 1,
  }
}

/** Start of the range in UTC. Days and weeks (Monday first) follow Pakistan time, like the agents' working day. */
export function rangeStart(range: CallRange, now: Date): Date | null {
  if (range === "all") return null
  const pkt = now.getTime() + PKT_OFFSET_MS
  const midnight = pkt - (pkt % DAY_MS)
  if (range === "today") return new Date(midnight - PKT_OFFSET_MS)
  const daysSinceMonday = (new Date(midnight).getUTCDay() + 6) % 7
  return new Date(midnight - daysSinceMonday * DAY_MS - PKT_OFFSET_MS)
}

export function callFiltersQuery(filters: CallFilters, over: Partial<CallFilters> = {}): string {
  const f = { ...filters, page: 1, ...over }
  const q = new URLSearchParams()
  if (f.agent) q.set("agent", f.agent)
  if (f.range !== "all") q.set("range", f.range)
  if (f.outcome) q.set("outcome", f.outcome)
  if (f.recording) q.set("recording", "yes")
  if (f.page > 1) q.set("page", String(f.page))
  const s = q.toString()
  return s ? `?${s}` : ""
}

/** The recording's own length when there is one, otherwise what the dialer logged in message_body. */
export function callSeconds(row: { recording_seconds: number | null; message_body: string | null }): number | null {
  if (row.recording_seconds != null) return row.recording_seconds
  const m = row.message_body?.match(/Duration:\s*(\d+)s/)
  return m ? parseInt(m[1], 10) : null
}

export function formatCallDuration(seconds: number | null): string {
  if (seconds == null) return "—"
  const mins = Math.floor(seconds / 60)
  return mins > 0 ? `${mins}m ${seconds % 60}s` : `${seconds}s`
}

export function outcomeLabel(disposition: string | null): string {
  if (!disposition) return "Not saved"
  return DISPOSITION_LABEL[disposition as DispositionKey] ?? disposition
}

export function formatPktTime(iso: string): string {
  const time = new Intl.DateTimeFormat("en-US", { timeZone: AGENT_TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
  return `${time.format(new Date(iso))} ${AGENT_TZ_ABBR}`
}

export function formatBrokerTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(iso))
}
