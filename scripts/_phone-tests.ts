// Offline checks for lib/phone.ts.   npx tsx scripts/_phone-tests.ts
import { formatPhoneDisplay, isValidPhone, parsePhone, toE164 } from "../lib/phone"

let failed = 0
function eq(name: string, got: unknown, want: unknown) {
  const ok = got === want
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
  if (!ok) failed++
}

const US = "+12143708737"

// Shapes of the same US number
for (const input of [
  "+1 (214) 370-8737",
  "214.370.8737",
  "1-214-370-8737",
  "(214)370-8737",
  "2143708737",
  "+12143708737",
  "001 214 370 8737", // 00 = +
  "tel:+12143708737",
  "Phone: (214) 370-8737",
  "  (214) 370-8737 \n",
  "214 370 8737", // NBSP
  "214–370–8737", // en-dash
  "２１４－３７０－８７３７", // fullwidth 214-370-8737
  "＋１ （214） 370-8737", // fullwidth +1 (214) 370-8737
])
  eq(`E.164 of ${JSON.stringify(input)}`, toE164(input), US)

// Extensions: number kept, extension separate
for (const input of ["214-370-8737 ext 12", "214-370-8737 x12", "(214) 370-8737 ext. 12", "214-370-8737 #12"]) {
  const p = parsePhone(input)
  eq(`ext number of ${JSON.stringify(input)}`, p?.e164, US)
  eq(`ext value of ${JSON.stringify(input)}`, p?.ext, "12")
}
eq("no extension -> ext null", parsePhone("214-370-8737")?.ext, null)

// Two numbers in one string -> the first
eq("two numbers: first one wins", toE164("214-370-8737 / 972-555-0100"), US)
eq("two numbers with labels", toE164("Office: (214) 370-8737, Mobile: (972) 555-0100"), US)

// International (default country is only a fallback)
eq("UK number", toE164("+44 20 7946 0958"), "+442079460958")
eq("Pakistan mobile", toE164("+92 300 1234567"), "+923001234567")
eq("UK written with 00", toE164("0044 20 7946 0958"), "+442079460958")
eq("Pakistan number WITHOUT country code is not guessed (default is US)", toE164("0300 1234567"), null)

// Invalid / short / fake
for (const bad of [
  "", "   ", "abc", "12345", "555-000-9911", "000-000-0000", "123-456-7890", "(555) 123-4567",
  "214-370-873", "214-370-87377", "+1 214 370", "+999 123", "n/a", "tel:", null, undefined,
])
  eq(`invalid ${JSON.stringify(bad)} -> null`, toE164(bad as string), null)
eq("isValidPhone true", isValidPhone("(214) 370-8737"), true)
eq("isValidPhone false", isValidPhone("555-000-9911"), false)

// Display: pretty in the UI, raw when invalid
eq("display US", formatPhoneDisplay("+12143708737"), "(214) 370-8737")
eq("display from messy input", formatPhoneDisplay("1-214-370-8737"), "(214) 370-8737")
eq("display with extension", formatPhoneDisplay("214-370-8737 x12"), "(214) 370-8737 ext. 12")
eq("display international", formatPhoneDisplay("+442079460958"), "+44 20 7946 0958")
eq("display invalid keeps the raw text", formatPhoneDisplay("555-000-9911"), "555-000-9911")
eq("display empty", formatPhoneDisplay(null), "")

// Idempotent: normalising an E.164 gives the same E.164
eq("idempotent", toE164(toE164("(214) 370-8737")), US)

console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) FAILED.`)
process.exit(failed === 0 ? 0 : 1)
