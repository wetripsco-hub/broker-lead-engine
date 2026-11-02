// Offline checks for lib/call-cooldown.ts.   npx tsx scripts/_call-cooldown-tests.ts
import { evaluateCooldown, isUnansweredStatus, cooldownMessage, MAX_UNANSWERED_TRIES, COOLDOWN_MINUTES } from "../lib/call-cooldown"

let failed = 0
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
  if (!ok) failed++
}

// All times on one day, UTC.
const t = (hhmm: string) => new Date(`2026-11-02T${hhmm}:00Z`)
const NA = (hhmm: string) => ({ at: t(hhmm), unanswered: true })
const ANS = (hhmm: string) => ({ at: t(hhmm), unanswered: false })
const until = (r: { until: Date | null }) => r.until?.toISOString() ?? null

eq("constants", [MAX_UNANSWERED_TRIES, COOLDOWN_MINUTES], [2, 60])

// Statuses
eq("no_answer is unanswered", isUnansweredStatus("no_answer"), true)
eq("pending is unanswered", isUnansweredStatus("pending"), true)
eq("failed is unanswered", isUnansweredStatus("failed"), true)
eq("answered is answered", isUnansweredStatus("answered"), false)
eq("null is answered (unknown)", isUnansweredStatus(null), false)

// 10:00 NA, 10:05 NA -> blocked until 11:05. At 11:05 -> allowed.
{
  const a = [NA("10:05"), NA("10:00")]
  const r = evaluateCooldown(a, t("10:06"))
  eq("two NA -> blocked", r.blocked, true)
  eq("two NA -> until 11:05", until(r), t("11:05").toISOString())
  eq("two NA -> streak 2", r.streak, 2)
  eq("at 11:04 still blocked", evaluateCooldown(a, t("11:04")).blocked, true)
  eq("at 11:05 allowed", evaluateCooldown(a, t("11:05")).blocked, false)
  eq("order of input does not matter", until(evaluateCooldown([NA("10:00"), NA("10:05")], t("10:06"))), t("11:05").toISOString())
}

// 10:05 NA, 11:06 NA -> streak 1 -> allowed.
{
  const a = [NA("11:06"), NA("10:05")]
  const r = evaluateCooldown(a, t("11:07"))
  eq("gap >= 60 min starts fresh -> allowed", r.blocked, false)
  eq("gap >= 60 min -> streak 1", r.streak, 1)
  // ... then 11:10 NA -> blocked until 12:10.
  const b = [NA("11:10"), NA("11:06"), NA("10:05")]
  const r2 = evaluateCooldown(b, t("11:11"))
  eq("11:06 + 11:10 NA -> blocked", r2.blocked, true)
  eq("11:06 + 11:10 NA -> until 12:10", until(r2), t("12:10").toISOString())
}

// Exactly 60 min apart counts as a new streak.
eq("exactly 60 min gap -> fresh streak", evaluateCooldown([NA("11:00"), NA("10:00")], t("11:01")).blocked, false)
eq("59 min gap -> same streak", evaluateCooldown([NA("10:59"), NA("10:00")], t("11:00")).blocked, true)

// 10:00 NA, 10:10 answered, 10:20 NA -> allowed.
eq("answered call ends the streak", evaluateCooldown([NA("10:20"), ANS("10:10"), NA("10:00")], t("10:21")).blocked, false)
eq("latest answered -> allowed", evaluateCooldown([ANS("10:20"), NA("10:10"), NA("10:00")], t("10:21")).blocked, false)

// Edge cases
eq("no attempts -> allowed", evaluateCooldown([], t("10:00")).blocked, false)
eq("one NA -> allowed", evaluateCooldown([NA("10:00")], t("10:01")).blocked, false)
eq("three NA -> blocked from the latest", until(evaluateCooldown([NA("10:20"), NA("10:10"), NA("10:00")], t("10:21"))), t("11:20").toISOString())

eq(
  "message",
  cooldownMessage("5:05 PM PKT", 59),
  "Cooldown: this broker was tried twice without an answer. Try again at 5:05 PM PKT (in 59 min).",
)

console.log(failed ? `\n${failed} FAILED` : "\nall passed")
if (failed) process.exit(1)
