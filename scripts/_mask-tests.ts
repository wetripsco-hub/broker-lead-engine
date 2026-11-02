// Offline checks for lib/mask.ts.   npx tsx scripts/_mask-tests.ts
import { maskPhone, maskEmail, timezonePhone, isMasked, phoneFor, emailFor } from "../lib/mask"
import { resolveTimezone } from "../lib/timezone/broker-time"

let failed = 0
function eq(name: string, got: unknown, want: unknown) {
  const ok = got === want
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
  if (!ok) failed++
}

// Phones
eq("E.164 US", maskPhone("+13125550147"), "(312) •••-••47")
eq("formatted US", maskPhone("(312) 555-0147"), "(312) •••-••47")
eq("digits only", maskPhone("3125550147"), "(312) •••-••47")
eq("null", maskPhone(null), null)
eq("undefined", maskPhone(undefined), null)
eq("empty", maskPhone("   "), null)
eq("invalid", maskPhone("12345"), "•••")
eq("garbage", maskPhone("call me"), "•••")
eq("no full digits left", /\d{4,}/.test(maskPhone("+12143708737") ?? ""), false)

// Emails
eq("email", maskEmail("john.smith@acmelogistics.com"), "j•••@a•••.com")
eq("email two-part TLD keeps last part", maskEmail("a@b.co.uk"), "a•••@b•••.uk")
eq("email trims", maskEmail("  Ops@Broker.io "), "O•••@B•••.io")
eq("email null", maskEmail(null), null)
eq("email empty", maskEmail(""), null)
eq("email invalid (no @)", maskEmail("not-an-email"), "•••")
eq("email invalid (no domain dot)", maskEmail("x@localhost"), "•••")
eq("email invalid (nothing before @)", maskEmail("@x.com"), "•••")

// Masked values still give the time zone from the area code
eq("isMasked masked", isMasked("(312) •••-••47"), true)
eq("isMasked real", isMasked("(312) 555-0147"), false)
eq("timezonePhone real unchanged", timezonePhone("+13125550147"), "+13125550147")
eq("masked 312 -> Chicago", resolveTimezone(null, timezonePhone(maskPhone("+13125550147")))?.tz, "America/Chicago")
eq("masked 212 -> New York", resolveTimezone(null, timezonePhone(maskPhone("+12125550100")))?.tz, "America/New_York")
eq("masked invalid -> no time zone", timezonePhone("•••"), null)

// The page switch
eq("phoneFor admin", phoneFor(false, "+13125550147"), "+13125550147")
eq("phoneFor agent", phoneFor(true, "+13125550147"), "(312) •••-••47")
eq("emailFor admin", emailFor(false, "a@b.com"), "a@b.com")
eq("emailFor agent", emailFor(true, "a@b.com"), "a•••@b•••.com")

console.log(failed ? `\n${failed} FAILED` : "\nall passed")
if (failed) process.exit(1)
