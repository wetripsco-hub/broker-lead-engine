import { resolveTimezone, getCallStatus, formatLocalTime, formatLocalWeekday, formatAgentClock, formatAgentTimeAt, formatDuration } from "@/lib/timezone/broker-time"

let failures = 0
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`}`)
}

console.log("── timezone resolution ──")
const ga = resolveTimezone("GA", null)!
check("GA -> New_York, Eastern Time, Georgia, exact", [ga.tz, ga.zoneLabel, ga.place, ga.approximate, ga.source], ["America/New_York", "Eastern Time", "Georgia", false, "state"])
check("CA -> Los_Angeles", resolveTimezone("ca", null)?.tz, "America/Los_Angeles")
check("AZ -> Phoenix", resolveTimezone("AZ", null)?.tz, "America/Phoenix")
check("TX is flagged approximate", resolveTimezone("TX", null)?.approximate, true)
check("full name 'Ontario' -> Toronto", resolveTimezone("Ontario", null)?.tz, "America/Toronto")
check("'N.Y.' punctuation is normalised to NY", resolveTimezone("N.Y.", null)?.tz, "America/New_York")
check("garbage 'Nowhere' is not guessed", resolveTimezone("Nowhere", null), null)
check("no state, area code 828 (NC) -> Eastern, source area_code", [resolveTimezone(null, "(828) 421-2607")?.tz, resolveTimezone(null, "8284212607")?.source], ["America/New_York", "area_code"])
check("+1 prefixed phone 213 (LA)", resolveTimezone("", "+1 213 555 0100")?.tz, "America/Los_Angeles")
check("850 (FL panhandle) -> Central", resolveTimezone(null, "8505550100")?.tz, "America/Chicago")
check("unusable state + unknown phone -> null (Timezone unknown)", resolveTimezone("ZZ", "555-000-1234"), null)
check("state wins over a conflicting area code", resolveTimezone("GA", "2135550100")?.tz, "America/New_York")

console.log("\n── inside / closing / outside (Thu 2026-10-01, US DST in effect) ──")
const GA = "America/New_York", CA = "America/Los_Angeles", AZ = "America/Phoenix"
let t = new Date("2026-10-01T14:00:00Z")
check("GA 10:00 AM EDT -> ok", getCallStatus(GA, t).state, "ok")
check("GA local time string", formatLocalTime(GA, t), "10:00 AM EDT")
check("CA 7:00 AM PDT -> closed, opens in 60m", [getCallStatus(CA, t).state, getCallStatus(CA, t).minutesUntilOpen], ["closed", 60])
check("CA local time string", formatLocalTime(CA, t), "7:00 AM PDT")
check("AZ 7:00 AM MST -> closed (no DST: MST not MDT)", [getCallStatus(AZ, t).state, formatLocalTime(AZ, t)], ["closed", "7:00 AM MST"])
check("Pakistan clock = UTC+5", formatAgentClock(t), "07:00 PM PKT")

t = new Date("2026-10-01T21:40:00Z")
check("GA 5:40 PM -> closing in 20m", [getCallStatus(GA, t).state, getCallStatus(GA, t).minutesUntilClose], ["closing", 20])
check("CA 2:40 PM -> ok", getCallStatus(CA, t).state, "ok")
t = new Date("2026-10-01T21:30:00Z")
check("GA 5:30 PM (exactly 30m left) -> closing", getCallStatus(GA, t).state, "closing")
t = new Date("2026-10-01T21:29:00Z")
check("GA 5:29 PM (31m left) -> ok", getCallStatus(GA, t).state, "ok")
t = new Date("2026-10-01T11:59:59Z")
check("GA 7:59:59 AM -> closed", getCallStatus(GA, t).state, "closed")
t = new Date("2026-10-01T12:00:00Z")
check("GA 8:00:00 AM sharp -> ok", getCallStatus(GA, t).state, "ok")
t = new Date("2026-10-01T22:00:00Z")
check("GA 6:00:00 PM sharp -> closed", getCallStatus(GA, t).state, "closed")

console.log("\n── after hours: when it opens, in broker + Pakistan time ──")
t = new Date("2026-10-02T02:00:00Z") // Thu 10:00 PM EDT, Fri 07:00 AM PKT
let s = getCallStatus(GA, t)
check("Thu 10 PM EDT -> closed, opens in 10h", [s.state, formatDuration(s.minutesUntilOpen!)], ["closed", "10h"])
check("…opens Fri 8 AM EDT = 5:00 PM PKT same day", formatAgentTimeAt(s.opensAt!, t), "5:00 PM PKT")
t = new Date("2026-10-03T00:30:00Z") // Fri 8:30 PM EDT
s = getCallStatus(GA, t)
check("Fri 8:30 PM -> closed (not 'weekend' yet), opens Monday, 2d 11h", [s.state, formatDuration(s.minutesUntilOpen!)], ["closed", "2d 11h"])

console.log("\n── weekend ──")
t = new Date("2026-10-03T15:00:00Z") // Sat 11:00 AM EDT, Sat 8:00 PM PKT
s = getCallStatus(GA, t)
check("Sat 11 AM EDT -> weekend", s.state, "weekend")
check("Sat 11 AM EDT weekday label", formatLocalWeekday(GA, t), "Saturday")
check("…opens Mon 8 AM EDT = Mon 5:00 PM PKT", formatAgentTimeAt(s.opensAt!, t), "Mon 5:00 PM PKT")
t = new Date("2026-10-04T20:00:00Z") // Sun 4 PM EDT
check("Sun -> weekend", getCallStatus(GA, t).state, "weekend")
t = new Date("2026-10-03T05:00:00Z") // Sat 01:00 EDT, but still Fri 22:00 PDT
check("same instant: GA is Saturday (weekend), CA still Friday night (closed)", [getCallStatus(GA, t).state, getCallStatus(CA, t).state], ["weekend", "closed"])

console.log("\n── DST: Arizona vs California ──")
t = new Date("2026-07-01T18:00:00Z")
check("summer: CA 11:00 AM PDT, AZ 11:00 AM MST (same wall clock)", [formatLocalTime(CA, t), formatLocalTime(AZ, t)], ["11:00 AM PDT", "11:00 AM MST"])
t = new Date("2026-12-01T18:00:00Z")
check("winter: CA 10:00 AM PST, AZ 11:00 AM MST (AZ didn't change)", [formatLocalTime(CA, t), formatLocalTime(AZ, t)], ["10:00 AM PST", "11:00 AM MST"])
t = new Date("2026-11-01T12:00:00Z") // US DST ends 2026-11-01 at 2:00 AM local
check("DST end day: NY 7:00 AM EST (after the change)", formatLocalTime(GA, t), "7:00 AM EST")
check("Pakistan has no DST: still UTC+5 in winter", formatAgentClock(new Date("2026-12-01T18:00:00Z")), "11:00 PM PKT")

console.log("\n── duration formatting ──")
check("formatDuration", [formatDuration(45), formatDuration(200), formatDuration(60), formatDuration(1500)], ["45m", "3h 20m", "1h", "1d 1h"])

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
