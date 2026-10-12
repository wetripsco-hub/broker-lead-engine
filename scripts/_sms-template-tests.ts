// Every quick SMS must fit ONE segment (160 plain characters), whatever the names are.
//   npx tsx scripts/_sms-template-tests.ts
import { buildSmsTemplates, SMS_ONE_SEGMENT } from "../lib/sms-templates"

export {}
let failed = 0
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` (${extra})` : ""}`)
  if (!ok) failed++
}

const cases: Array<[string | null, string | null]> = [
  ["Toria N Boyd", "Shahid"],
  ["Christopher Montgomery-Hernandez", "Alexandria Featherstonehaugh"],
  [null, null],
  ["Ali", "support@gmail.com"],
]
for (const [contact, agent] of cases) {
  for (const t of buildSmsTemplates({ contactName: contact, agentName: agent })) {
    check(`${t.id} fits one SMS for ${contact ?? "no contact"} / ${agent ?? "no agent"}`, t.text.length <= SMS_ONE_SEGMENT, `${t.text.length} chars`)
    check(`${t.id} is plain ASCII (no curly quotes/emoji)`, /^[\x20-\x7E]+$/.test(t.text))
    check(`${t.id} has the link and the opt-out`, /loadlinkers\.co/.test(t.text) && /STOP/.test(t.text))
  }
}
const main = buildSmsTemplates({ contactName: "Toria N Boyd", agentName: "Shahid" })[0].text
console.log("\nExample:", main, `(${main.length} chars)`)
console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) FAILED.`)
process.exit(failed === 0 ? 0 : 1)
