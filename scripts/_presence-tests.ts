// Offline checks for lib/presence.ts.   npx tsx scripts/_presence-tests.ts
import { isOnline, timeAgo, formatPkt } from "../lib/presence"

let failed = 0
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
  if (!ok) failed++
}

const now = new Date("2026-11-03T16:00:00Z")
const ago = (s: number) => new Date(now.getTime() - s * 1000).toISOString()

eq("never seen -> offline", isOnline(null, null, now), false)
eq("seen 30 s ago -> online", isOnline(ago(30), null, now), true)
eq("seen 2.5 min ago -> online", isOnline(ago(150), null, now), true)
eq("seen 3 min ago -> offline", isOnline(ago(180), null, now), false)
eq("signed out after last heartbeat -> offline", isOnline(ago(30), ago(10), now), false)
eq("signed in again after sign-out -> online", isOnline(ago(10), ago(600), now), true)

eq("just now", timeAgo(ago(20), now), "just now")
eq("minutes", timeAgo(ago(5 * 60), now), "5 min ago")
eq("hours", timeAgo(ago(3 * 3600), now), "3 h ago")
eq("one day", timeAgo(ago(26 * 3600), now), "1 day ago")
eq("days", timeAgo(ago(3 * 86400), now), "3 days ago")
eq("future clamps", timeAgo(ago(-60), now), "just now")

eq("PKT", formatPkt("2026-11-03T15:31:00Z"), "Nov 3, 8:31 PM PKT")

console.log(failed ? `\n${failed} FAILED` : "\nall passed")
if (failed) process.exit(1)
