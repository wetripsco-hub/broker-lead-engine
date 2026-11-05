// Agent's own time zone from their IP (doc/AGENT_TIMEZONE_RUNBOOK.md).
// Run: npx tsx scripts/_agent-timezone-tests.ts
import { readFileSync } from "node:fs"
import {
  AGENT_TZ,
  formatAgentClock,
  formatAgentTimeAt,
  getCallStatus,
  isValidTimezone,
  safeTimezone,
  timezoneAbbr,
} from "@/lib/timezone/broker-time"
import { checkCallingWindow } from "@/lib/timezone/calling-window"
import {
  countryName,
  decodeCity,
  describeLocation,
  locationChanged,
  locationFromHeaders,
  normaliseCountry,
  pickTimezone,
  utcOffsetLabel,
} from "@/lib/timezone/viewer-location"

let failures = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : `\n        got ${JSON.stringify(detail)}`}`)
}
const eq = (name: string, actual: unknown, expected: unknown) =>
  check(name, JSON.stringify(actual) === JSON.stringify(expected), actual)
const read = (p: string) => readFileSync(p, "utf8")

console.log("── zone validation ──")
eq("Asia/Karachi is valid", isValidTimezone("Asia/Karachi"), true)
eq("Africa/Lagos is valid", isValidTimezone("Africa/Lagos"), true)
eq("Europe/London is valid", isValidTimezone("Europe/London"), true)
eq("garbage is invalid", isValidTimezone("Mars/Olympus"), false)
eq("empty / null / undefined are invalid", [isValidTimezone(""), isValidTimezone(null), isValidTimezone(undefined)], [false, false, false])
eq("absurdly long value is invalid", isValidTimezone("A".repeat(200)), false)
eq("safeTimezone keeps a valid zone", safeTimezone("Africa/Lagos"), "Africa/Lagos")
eq("safeTimezone falls back to PKT", safeTimezone("nope"), AGENT_TZ)

console.log("\n── fallback order: IP header → browser → Asia/Karachi ──")
eq("header wins", pickTimezone("Africa/Lagos", "Europe/London"), "Africa/Lagos")
eq("invalid header → browser", pickTimezone("Not/AZone", "Europe/London"), "Europe/London")
eq("no header → browser", pickTimezone(null, "Europe/London"), "Europe/London")
eq("neither valid → Asia/Karachi", pickTimezone("x", "y"), "Asia/Karachi")
eq("nothing at all → Asia/Karachi", pickTimezone(undefined, undefined), "Asia/Karachi")

console.log("\n── Vercel headers ──")
const hdrs = (h: Record<string, string>) => (name: string) => h[name] ?? null
eq(
  "Lagos headers, city URL-decoded",
  locationFromHeaders(hdrs({ "x-vercel-ip-timezone": "Africa/Lagos", "x-vercel-ip-country": "ng", "x-vercel-ip-city": "Lagos" }), "Asia/Karachi"),
  { timezone: "Africa/Lagos", country: "NG", city: "Lagos" },
)
eq("encoded city", decodeCity("S%C3%A3o%20Paulo"), "São Paulo")
eq("broken encoding keeps the raw text", decodeCity("100%"), "100%")
eq("empty city → null", decodeCity("  "), null)
eq("country must be 2 letters", [normaliseCountry("pk"), normaliseCountry("PAK"), normaliseCountry(null)], ["PK", null, null])
eq(
  "localhost (no headers) uses the browser zone",
  locationFromHeaders(hdrs({}), "Europe/London"),
  { timezone: "Europe/London", country: null, city: null },
)

console.log("\n── write only when something changed ──")
const saved = { ip_timezone: "Africa/Lagos", ip_country: "NG", ip_city: "Lagos" }
eq("same location → no write", locationChanged(saved, { timezone: "Africa/Lagos", country: "NG", city: "Lagos" }), false)
eq("new zone → write", locationChanged(saved, { timezone: "Europe/London", country: "NG", city: "Lagos" }), true)
eq("new city → write", locationChanged(saved, { timezone: "Africa/Lagos", country: "NG", city: "Abuja" }), true)
eq("nothing saved yet → write", locationChanged({ ip_timezone: null, ip_country: null, ip_city: null }, { timezone: "Asia/Karachi", country: null, city: null }), true)

console.log("\n── abbreviation ──")
const winter = new Date("2026-01-15T12:00:00Z")
const summer = new Date("2026-07-15T12:00:00Z")
eq("Asia/Karachi → PKT", timezoneAbbr("Asia/Karachi", winter), "PKT")
const lagos = timezoneAbbr("Africa/Lagos", winter)
check("Africa/Lagos → WAT or GMT+1", lagos === "WAT" || lagos === "GMT+1", lagos)
const london = [timezoneAbbr("Europe/London", winter), timezoneAbbr("Europe/London", summer)]
check("Europe/London → GMT in winter, BST/GMT+1 in summer", london[0] === "GMT" && (london[1] === "BST" || london[1] === "GMT+1"), london)
eq("New York keeps EST/EDT", [timezoneAbbr("America/New_York", winter), timezoneAbbr("America/New_York", summer)], ["EST", "EDT"])
eq("invalid zone in the formatter → PKT clock", formatAgentClock(new Date("2026-10-01T14:00:00Z"), "Bad/Zone"), "07:00 PM PKT")

console.log("\n── agent-facing times in the agent's zone ──")
const t = new Date("2026-10-01T14:00:00Z") // 7:00 PM PKT, 3:00 PM WAT
eq("default (admin / other callers) stays PKT", formatAgentClock(t), "07:00 PM PKT")
eq("explicit PKT is the same", formatAgentClock(t, "Asia/Karachi"), "07:00 PM PKT")
check("Lagos agent sees 03:00 PM", formatAgentClock(t, "Africa/Lagos").startsWith("03:00 PM "), formatAgentClock(t, "Africa/Lagos"))
const opens = new Date("2026-10-02T12:00:00Z") // Fri 8 AM EDT
eq("Call at, PKT agent", formatAgentTimeAt(opens, t), "Fri 5:00 PM PKT")
check("Call at, Lagos agent: 1:00 PM next day", /^Fri 1:00 PM (WAT|GMT\+1)$/.test(formatAgentTimeAt(opens, t, "Africa/Lagos")), formatAgentTimeAt(opens, t, "Africa/Lagos"))
eq("same-day check uses the agent's zone", formatAgentTimeAt(new Date("2026-10-01T15:00:00Z"), t, "Africa/Lagos").startsWith("4:00 PM"), true)

console.log("\n── admin page location line ──")
eq("NG → Nigeria", countryName("NG"), "Nigeria")
eq("PK → Pakistan", countryName("PK"), "Pakistan")
eq("no country → null", countryName(null), null)
eq("UTC offsets", [utcOffsetLabel("Africa/Lagos", winter), utcOffsetLabel("Asia/Karachi", winter), utcOffsetLabel("Asia/Kolkata", winter), utcOffsetLabel("America/New_York", winter), utcOffsetLabel("UTC", winter)], ["UTC+1", "UTC+5", "UTC+5:30", "UTC−5", "UTC"])
check(
  "Lagos line",
  /^Lagos, Nigeria · (WAT|GMT\+1) \(UTC\+1\)$/.test(describeLocation({ city: "Lagos", country: "NG", timezone: "Africa/Lagos" }, winter)),
  describeLocation({ city: "Lagos", country: "NG", timezone: "Africa/Lagos" }, winter),
)
eq("Karachi line", describeLocation({ city: "Karachi", country: "PK", timezone: "Asia/Karachi" }, winter), "Karachi, Pakistan · PKT (UTC+5)")
eq("no city / country → zone only", describeLocation({ city: null, country: null, timezone: "Asia/Karachi" }, winter), "PKT (UTC+5)")

console.log("\n── calling rules unchanged (broker's zone, server clock) ──")
const sevenPmEdt = new Date("2026-10-01T23:00:00Z") // Thu 7 PM EDT
const tenAmEdt = new Date("2026-10-01T14:00:00Z") // Thu 10 AM EDT
eq("broker at 7 PM local is blocked", checkCallingWindow("GA", null, sevenPmEdt).inside, false)
eq("broker at 10 AM local is open", checkCallingWindow("GA", null, tenAmEdt).inside, true)
eq("getCallStatus only takes the broker's zone", getCallStatus.length, 2)
const windowSrc = read("lib/timezone/calling-window.ts")
check("calling window doesn't read the agent's zone", !/viewer|ip_timezone|viewerTz/.test(windowSrc))
const rulesSrc = read("lib/agent-call-rules.ts")
check("after-hours grants don't use the agent's zone", !/viewerTz/.test(rulesSrc.slice(rulesSrc.indexOf("export async function activeGrant"), rulesSrc.indexOf("export async function checkHourlyLimit"))))
const cooldownSrc = read("lib/call-cooldown.ts")
check("cooldown rule itself has no zone", !/timeZone|ip_timezone|viewerTz/.test(cooldownSrc))

console.log("\n── wiring ──")
const migration = read("supabase/migrations/20261105000001_agents_ip_location.sql")
check("migration adds the four columns", ["ip_timezone text", "ip_country text", "ip_city text", "ip_location_at timestamptz"].every((c) => migration.includes(c)))
check("migration guards the columns from agents", /before update on public\.agents/.test(migration) && /auth\.uid\(\) is null or public\.is_admin\(\)/.test(migration))
const serverTz = read("lib/timezone/viewer-timezone.ts")
check("location is written with the service role", /createAdminClient\(\)[\s\S]*\.update\(\{[\s\S]*ip_timezone/.test(serverTz))
check("location is written only when it changed", serverTz.indexOf("locationChanged(") > -1 && serverTz.indexOf("locationChanged(") < serverTz.indexOf(".update("))
check("reads Vercel headers through headers()", /await headers\(\)/.test(serverTz) && read("lib/timezone/viewer-location.ts").includes("x-vercel-ip-timezone"))
check("admin viewer gets PKT", /isAdminInDb[\s\S]*return AGENT_TZ/.test(serverTz))
check("heartbeat sends the browser zone", /heartbeat\(browserTz\)/.test(read("components/layout/presence-heartbeat.tsx")))
check("heartbeat records the location", /recordAgentLocation\(user\.id/.test(read("app/(dashboard)/presence-actions.ts")))
check("sign-in records the location", /recordAgentLocation\(signedIn\.user\.id/.test(read("app/(auth)/login/actions.ts")))
check("login form sends the browser zone", /name="tz"/.test(read("app/(auth)/login/login-form.tsx")))
const card = read("components/leads/local-time-card.tsx")
check("lead card: 'Your time' for agents, 'Pakistan' for the admin", card.includes(`isAgent ? "Your time" : "Pakistan"`))
check("banner uses the agent's zone", /formatAgentTimeAt\(new Date\(state\.cooldown\.until\), now, state\.viewerTz\)/.test(read("components/leads/agent-call-banner.tsx")))
check("call-status 'Call at' takes the zone", /formatAgentTimeAt\(status\.opensAt, now, tz\)/.test(read("components/leads/call-status.tsx")))
check("server cooldown message uses the agent's zone", /formatAgentTimeAt\(result\.until, now, tz\)/.test(read("lib/call-cooldown-guard.ts")))
check("server hourly message uses the agent's zone", /formatAgentTimeAt\(r\.blockedUntil, now, tz\)/.test(rulesSrc))
const tour = read("app/onboarding/tour/tour-client.tsx")
check("tour says 'next to your local time'", tour.includes("next to your local time") && !tour.includes("next to PKT"))
check("tour example clock uses the agent's zone", /formatAgentTimeAt\(EXAMPLE_INSTANT, EXAMPLE_INSTANT, agentTz\)/.test(tour))
check("admin Agents page keeps last login in PKT", read("app/(dashboard)/agents/agents-client.tsx").includes("formatPkt(agent.last_sign_in_at)"))
check("admin call reviews stay PKT", read("lib/calls/review.ts").includes("AGENT_TZ_ABBR"))

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.")
process.exit(failures ? 1 : 0)
