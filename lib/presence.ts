// Who is online right now (admin Agents page). Every open dashboard tab sends
// a heartbeat every HEARTBEAT_SECONDS; an agent counts as online while the
// latest one is recent and they haven't signed out since. Pure: `now` is passed in.

export const HEARTBEAT_SECONDS = 60
/** Two missed heartbeats plus some slack. */
export const ONLINE_WINDOW_SECONDS = 150

export function isOnline(lastSeenAt: string | null, lastSignedOutAt: string | null, now: Date): boolean {
  if (!lastSeenAt) return false
  const seen = new Date(lastSeenAt).getTime()
  if (lastSignedOutAt && new Date(lastSignedOutAt).getTime() >= seen) return false
  return now.getTime() - seen <= ONLINE_WINDOW_SECONDS * 1000
}

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function timeAgo(iso: string, now: Date): string {
  const sec = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000))
  if (sec < 60) return "just now"
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} min ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.floor(h / 24)
  return `${d} day${d === 1 ? "" : "s"} ago`
}

/** Pakistan time, e.g. "Nov 3, 8:31 PM PKT". */
export function formatPkt(iso: string): string {
  return (
    new Date(iso).toLocaleString("en-US", {
      timeZone: "Asia/Karachi",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }) + " PKT"
  )
}
