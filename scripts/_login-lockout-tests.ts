// Offline checks for lib/login-lockout.ts.   npx tsx scripts/_login-lockout-tests.ts
import {
  registerFailure,
  lockedUntil,
  lockedMessage,
  wrongPasswordMessage,
  normaliseLoginEmail,
  MAX_FAILED_LOGINS,
  LOCKOUT_MINUTES,
  type LockoutRow,
} from "../lib/login-lockout"

let failed = 0
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
  if (!ok) failed++
}

const at = (m: number, s = 0) => new Date(Date.UTC(2026, 10, 2, 10, m, s))

eq("constants", [MAX_FAILED_LOGINS, LOCKOUT_MINUTES], [5, 5])
eq("email normalised", normaliseLoginEmail("  Ali@Example.COM "), "ali@example.com")

// Five wrong passwords in a row -> locked for 5 minutes.
let row: LockoutRow | null = null
const left: number[] = []
let locked = false
for (let i = 0; i < 5; i++) {
  const r = registerFailure(row, at(0, i * 10))
  row = r.row
  left.push(r.triesLeft)
  locked = r.locked
}
eq("tries left after each wrong password", left, [4, 3, 2, 1, 0])
eq("5th wrong password locks", locked, true)
eq("locked until 5 min after the 5th", row!.locked_until, at(5, 40).toISOString())
eq("locked at +4 min", lockedUntil(row, at(4))?.toISOString() ?? null, at(5, 40).toISOString())
eq("unlocked at +5 min 40 s", lockedUntil(row, at(5, 40)), null)
eq("4 wrong passwords -> not locked", lockedUntil(registerFailure(registerFailure(registerFailure(registerFailure(null, at(0)).row, at(1)).row, at(2)).row, at(3)).row, at(3)), null)

// After the lock runs out the count starts again.
{
  const r = registerFailure(row, at(6))
  eq("first failure after lock -> count 1", r.row.failed_count, 1)
  eq("... not locked", r.locked, false)
  eq("... 4 tries left", r.triesLeft, 4)
}

// Old failures are forgotten after 15 minutes.
{
  let r = registerFailure(null, at(0))
  for (let i = 1; i < 4; i++) r = registerFailure(r.row, at(i))
  eq("4 failures -> count 4", r.row.failed_count, 4)
  const later = registerFailure(r.row, at(20))
  eq("20 min later -> starts over at 1", later.row.failed_count, 1)
  eq("... not locked", later.locked, false)
}

eq("no row -> not locked", lockedUntil(null, at(0)), null)
eq("locked message minutes", lockedMessage(at(5), at(0)), "Too many wrong passwords. Sign-in is locked for this email — try again in 5 min.")
eq("locked message seconds", lockedMessage(at(0, 30), at(0)), "Too many wrong passwords. Sign-in is locked for this email — try again in 30 sec.")
eq("wrong password message", wrongPasswordMessage(2), "Wrong email or password. 2 tries left before sign-in is locked for 5 minutes.")
eq("wrong password message (1)", wrongPasswordMessage(1), "Wrong email or password. 1 try left before sign-in is locked for 5 minutes.")

console.log(failed ? `\n${failed} FAILED` : "\nall passed")
if (failed) process.exit(1)
