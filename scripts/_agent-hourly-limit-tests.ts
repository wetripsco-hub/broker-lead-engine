// Offline checks for lib/agent-hourly-limit.ts and the shared calling window.
//   npx tsx scripts/_agent-hourly-limit-tests.ts
import { evaluateHourlyLimit, hourlyLimitMessage, minutesUntil, HOURLY_CALL_LIMIT } from "../lib/agent-hourly-limit"
import { checkCallingWindow } from "../lib/timezone/calling-window"

let failed = 0
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
  if (!ok) failed++
}

const at = (h: number, m: number, s = 0) => new Date(Date.UTC(2026, 10, 2, h, m, s))
const iso = (d: Date | null) => d?.toISOString() ?? null

eq("limit is 40", HOURLY_CALL_LIMIT, 40)

// 40 calls from 10:00 to 10:39 -> blocked until 11:00.
const forty = Array.from({ length: 40 }, (_, i) => at(10, i))
{
  const r = evaluateHourlyLimit(forty, at(10, 40))
  eq("40 calls -> count 40", r.count, 40)
  eq("40 calls -> blocked", r.blocked, true)
  eq("40 calls -> until 11:00", iso(r.blockedUntil), at(11, 0).toISOString())
  eq("about 20 min to wait", minutesUntil(r.blockedUntil!, at(10, 40)), 20)
  eq("still blocked at 10:59:59", evaluateHourlyLimit(forty, at(10, 59, 59)).blocked, true)
}
// At 11:00 one call is allowed again...
{
  const r = evaluateHourlyLimit(forty, at(11, 0))
  eq("at 11:00 -> allowed", r.blocked, false)
  eq("at 11:00 -> 39 in the hour", r.count, 39)
  // ...and after that call the next opens when 10:01 leaves the hour.
  const r2 = evaluateHourlyLimit([...forty, at(11, 0)], at(11, 0, 30))
  eq("one more call at 11:00 -> blocked again", r2.blocked, true)
  eq("... until 11:01", iso(r2.blockedUntil), at(11, 1).toISOString())
}

eq("39 calls -> allowed", evaluateHourlyLimit(forty.slice(1), at(10, 40)).blocked, false)
eq("no calls -> count 0", evaluateHourlyLimit([], at(10, 0)), { count: 0, blocked: false, blockedUntil: null })
eq("old calls don't count", evaluateHourlyLimit(forty, at(12, 0)).count, 0)
eq(
  "message",
  hourlyLimitMessage("4:00 PM PKT", 20),
  "Hourly limit reached (40 calls in the last hour). You can call again at 4:00 PM PKT (in 20 min).",
)
eq("minutesUntil never below 1", minutesUntil(at(10, 0, 10), at(10, 0)), 1)

// Shared calling window (same rules as the AI gate). Nov 2 2026 is a Monday; New York is UTC-5.
eq("GA Mon 10:00 local -> inside", checkCallingWindow("GA", null, at(15, 0)).inside, true)
eq("GA Mon 5:45 PM local (closing) -> inside", checkCallingWindow("GA", null, at(22, 45)).inside, true)
eq("GA Mon 7:42 PM local -> outside_hours", (checkCallingWindow("GA", null, at(0 + 24, 42)) as any).reason, "outside_hours")
eq("GA Mon 7:59 AM local -> outside_hours", (checkCallingWindow("GA", null, at(12, 59)) as any).reason, "outside_hours")
eq("GA Sat -> weekend", (checkCallingWindow("GA", null, new Date(Date.UTC(2026, 10, 7, 15, 0))) as any).reason, "weekend")
eq("unknown state + no phone -> unknown_timezone", (checkCallingWindow(null, null, at(15, 0)) as any).reason, "unknown_timezone")
// TX is split across zones: 8:30 AM Central fails the hour-earlier probe.
eq("TX 8:30 AM (approximate) -> outside", checkCallingWindow("TX", null, at(14, 30)).inside, false)
eq("TX 10:00 AM -> inside", checkCallingWindow("TX", null, at(16, 0)).inside, true)

console.log(failed ? `\n${failed} FAILED` : "\nall passed")
if (failed) process.exit(1)
