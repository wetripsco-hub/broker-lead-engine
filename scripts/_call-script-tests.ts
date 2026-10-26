// Call script, outcomes and SMS permission rules.
//   npx tsx scripts/_call-script-tests.ts
import { readFileSync } from "fs"
import { CALL_SCRIPT, GUIDED_ORDER, OUTCOME_NEXT_ACTION } from "../lib/call-script/script"
import { agentNames, fillSegments, fillText, missingPlaceholders, type ScriptVars } from "../lib/call-script/fill"
import { contactFirstNameOrNull } from "../lib/voice-agents/names"
import {
  DISPOSITION_LABEL,
  DISPOSITION_MENU,
  DISPOSITION_STAGE,
  DISPOSITION_STATUS,
  isSmsPermissionOutcome,
  type DispositionKey,
} from "../lib/call-dispositions"
import { evaluateSmsPermission, SMS_BLOCK_DNC, SMS_BLOCK_NO_CONSENT } from "../lib/sms-permission"

export {}
let failed = 0
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` (${extra})` : ""}`)
  if (!ok) failed++
}
const read = (p: string) => readFileSync(p, "utf8")

function vars(over: Partial<ScriptVars> = {}): ScriptVars {
  const base: ScriptVars = { name: "Toria", firstName: "Shahid", fullName: "Shahid Ali", phone: "(214) 555-0100", day: "Thursday", time: "2:30 PM" }
  return { ...base, ...over }
}

// ── Placeholders ──────────────────────────────────────────────────────────────
{
  const t = "Hey [Name]? It's [First Name], [Full Name]. Call on [day] at [time]. My number is [number]."
  check("fill: all placeholders filled when known", fillText(t, vars()) === "Hey Toria? It's Shahid, Shahid Ali. Call on Thursday at 2:30 PM. My number is (214) 555-0100.")
  const none = vars({ name: null, firstName: null, fullName: null, phone: null, day: "", time: "  " })
  check("fill: unknown values stay as the visible placeholder, never blank", fillText(t, none) === t)
  check("fill: every unknown placeholder is flagged missing", missingPlaceholders(t, none).sort().join() === ["Full Name", "First Name", "Name", "day", "number", "time"].sort().join())
  check("fill: filled values are not flagged", missingPlaceholders(t, vars()).length === 0)
  const seg = fillSegments("Hi [Name], call [Phone]", vars({ phone: null }))
  check("fill: a missing one is a separate highlighted segment", seg.some((s) => s.missing === "Phone" && s.text === "[Phone]") && !seg.some((s) => s.missing === "Name"))
  check("fill: [number] and [Phone] both use the callback number", fillText("[number] / [Phone]", vars()) === "(214) 555-0100 / (214) 555-0100")
}

// ── Names ─────────────────────────────────────────────────────────────────────
check("contact first name: two people -> the first one's first name", contactFirstNameOrNull("John Smith / Mary Jones") === "John")
check("contact first name: 'Smith, John' -> John", contactFirstNameOrNull("SMITH, JOHN") === "John")
check("contact first name: missing -> null (not 'there')", contactFirstNameOrNull(null) === null && contactFirstNameOrNull("   ") === null)
check("agent names: email-looking name is treated as missing", agentNames("me@gmail.com").firstName === null && agentNames("me@gmail.com").fullName === null)
check("agent names: first word is the first name", agentNames("Shahid Ali").firstName === "Shahid" && agentNames("Shahid Ali").fullName === "Shahid Ali")
check("agent names: empty -> missing", agentNames("").firstName === null && agentNames(null).fullName === null)

// ── The script data matches the doc ───────────────────────────────────────────
{
  const ids = CALL_SCRIPT.map((s) => s.id)
  check("script: has every section of the doc", ["opener", "yes", "no", "marketplace", "marketplace-first", "voicemail", "text", "email"].every((id) => ids.includes(id)), ids.join(","))
  const no = CALL_SCRIPT.find((s) => s.id === "no")!
  check("script: No path has one item per objection (TMS, Ascend, not interested, email, price, busy) + final no", no.items.length === 7)
  check("script: guided order points at real sections", GUIDED_ORDER.every((id) => ids.includes(id)))
  const allText = CALL_SCRIPT.flatMap((s) => s.items.flatMap((i) => i.lines.map((l) => l.text))).join("\n")
  const tokens = [...allText.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1])
  const known = new Set(["Name", "First Name", "Full Name", "day", "time", "number", "Phone"])
  check("script: every [placeholder] in the text is one the app can fill", tokens.every((t) => known.has(t)), [...new Set(tokens.filter((t) => !known.has(t)))].join(","))
  const texts = CALL_SCRIPT.find((s) => s.id === "text")!
  check("script: both texts are copyable and end with the STOP opt-out", texts.items.length === 2 && texts.items.every((i) => !!i.copy && /Reply STOP to opt out\.$/.test(i.lines[0].text)))
  const email = CALL_SCRIPT.find((s) => s.id === "email")!.items[0]
  check("script: the email has a subject and is copyable", email.copy?.subject === "Getting your loads off spreadsheets")
  const doc = read("doc/loadlinkers-call-script.md")
  check("script: the doc's opener and price line are the ones in the data file", allText.includes("I saw your authority went active recently") && doc.includes("I saw your authority went active recently") && allText.includes("$69 a month"))
}

// ── Outcomes (section 9 of the doc) ───────────────────────────────────────────
{
  const labels = DISPOSITION_MENU.map((k) => DISPOSITION_LABEL[k])
  const docNine = ["Demo booked", "Trial link sent", "Marketplace link sent", "Callback requested", "Email requested", "Voicemail left", "Not interested", "Do not call", "Wrong number"]
  check("outcomes: the menu has the nine outcomes of the doc, in order", docNine.every((l, i) => labels[i] === l), labels.join(" | "))
  check("outcomes: plus 'No answer' for calls nobody picked up", labels[9] === "No answer" && labels.length === 10)
  const all = Object.keys(DISPOSITION_LABEL) as DispositionKey[]
  check("outcomes: every key has a label, status and stage rule", all.every((k) => k in DISPOSITION_STATUS && k in DISPOSITION_STAGE))
  check("outcomes: every menu option has a next-action line", DISPOSITION_MENU.every((k) => !!OUTCOME_NEXT_ACTION[k]))
  check("outcomes: old keys still valid (AI calls, export)", ["answered_interested", "answered_not_interested"].every((k) => k in DISPOSITION_LABEL) && DISPOSITION_LABEL.answered_interested === "Answered — interested")
  check("outcomes: only Trial/Marketplace link sent record SMS permission", all.filter((k) => isSmsPermissionOutcome(k)).join() === "trial_link_sent,marketplace_link_sent")
  check("outcomes: do-not-call moves the lead to dead", DISPOSITION_STAGE.do_not_call === "dead")
}

// ── SMS permission ────────────────────────────────────────────────────────────
{
  const f = (o: object) => evaluateSmsPermission({ isAdmin: false, doNotCall: false, hasSmsConsent: false, hasInbound: false, ...o })
  check("sms: admin may text any lead, even with no permission recorded", f({ isAdmin: true }).allowed === true)
  check("sms: an agent without permission is blocked, with a clear reason", (() => { const d = f({}); return !d.allowed && d.reason === SMS_BLOCK_NO_CONSENT })())
  check("sms: an agent with permission recorded on a call may text", f({ hasSmsConsent: true }).allowed === true)
  check("sms: an agent may reply to someone who texted first", f({ hasInbound: true }).allowed === true)
  check("sms: do-not-call blocks the agent even with permission", (() => { const d = f({ doNotCall: true, hasSmsConsent: true }); return !d.allowed && d.reason === SMS_BLOCK_DNC })())
  check("sms: do-not-call blocks the admin too", f({ isAdmin: true, doNotCall: true }).allowed === false)
}

// ── Wiring (static) ───────────────────────────────────────────────────────────
{
  const sms = read("app/(dashboard)/leads/[id]/sms-actions.ts")
  check("wiring: sendLeadSms checks permission server-side and takes the number from the lead", /checkSmsAllowed\(/.test(sms) && /phone_e164/.test(sms) && /\.eq\("id", leadId\)/.test(sms))
  const inbox = read("app/(dashboard)/messages/actions.ts")
  check("wiring: the inbox SMS action uses the same permission check", /checkSmsAllowed\(/.test(inbox))
  const call = read("app/(dashboard)/leads/[id]/call-actions.ts")
  check("wiring: starting a call is refused for do-not-call leads", /blocked: true/.test(call) && /do_not_call_numbers/.test(call))
  check("wiring: SMS permission is stored once, with the service role, only for link-sent outcomes", /isSmsPermissionOutcome\(disposition\)/.test(call) && /sms_consent_at/.test(call) && /\.is\("sms_consent_at", null\)/.test(call))
  check("wiring: do-not-call outcome flags the lead and the number list", /do_not_call: true/.test(call) && /upsert\(/.test(call))
  check("wiring: outcome is saved in the disposition column", /^\s+disposition,$/m.test(call))
  const dialer = read("components/leads/dialer-modal.tsx")
  check("wiring: the dialer stops (no call placed) when the server says blocked", /if \(blocked\)/.test(dialer) && dialer.indexOf("if (blocked)") < dialer.indexOf("newCall("))
  check("wiring: the script panel sits in the call overlay", /<CallScriptPanel variant="dialer"/.test(dialer))
  const mig = read("supabase/migrations/20261026000001_sms_consent.sql")
  check("migration: two columns, guarded against direct edits by agents", /sms_consent_at timestamptz/.test(mig) && /sms_consent_source text/.test(mig) && /SMS consent is recorded by the app/.test(mig))
}

console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) FAILED.`)
process.exit(failed === 0 ? 0 : 1)
