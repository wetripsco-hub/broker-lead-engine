// Inbound callbacks: number matching, business hours, ring / no-answer / voicemail flow,
// idempotency, cooldown reset, agent masking, webhook signature.
//   npx tsx scripts/_inbound-callback-tests.ts
import { generateKeyPairSync, sign } from "crypto"
import { readFileSync } from "fs"
import { toE164 } from "../lib/phone"
import {
  forwardMissReason,
  isWithinBusinessHours,
  pickCallbackLead,
  voicemailScript,
  DEFAULT_GREETING,
  type BusinessHours,
} from "../lib/callbacks/rules"
import {
  decodeForwardState,
  encodeForwardState,
  handleInboundEvent,
  inboundSignatureProblem,
  voicemailPath,
  type CallbackRow,
  type CallbackStatus,
  type InboundDeps,
  type InboundSettings,
} from "../lib/telnyx/inbound"
import { openCallbacksFrom } from "../lib/callbacks/badge"
import { evaluateCooldown } from "../lib/call-cooldown"
import { callbackEmail } from "../lib/callbacks/server"

export {}
let failed = 0
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` (${extra})` : ""}`)
  if (!ok) failed++
}
const read = (p: string) => readFileSync(p, "utf8")

// ── Number normalising + lead matching ───────────────────────────────────────

check("E.164: Telnyx-style +1 number unchanged", toE164("+12145550147") === "+12145550147")
check("E.164: national format", toE164("(214) 555-0147") === "+12145550147")
check("E.164: 1-prefixed digits", toE164("12145550147") === "+12145550147")
check("E.164: anonymous caller is not a number", toE164("anonymous") === null)

{
  const pick = pickCallbackLead([
    { leadId: "old-called", assignedAgentId: "a1", createdAt: "2026-11-01T00:00:00Z", lastCall: { at: "2026-11-10T10:00:00Z", agentId: "a2" } },
    { leadId: "recent-called", assignedAgentId: "a3", createdAt: "2026-10-01T00:00:00Z", lastCall: { at: "2026-11-15T10:00:00Z", agentId: "a4" } },
    { leadId: "never-called", assignedAgentId: "a5", createdAt: "2026-11-16T00:00:00Z", lastCall: null },
  ])
  check("match: several leads -> the most recently called wins", pick?.leadId === "recent-called")
  check("match: agent is whoever made that last call (not the assignee)", pick?.agentId === "a4")
  const none = pickCallbackLead([
    { leadId: "older", assignedAgentId: "a1", createdAt: "2026-10-01T00:00:00Z", lastCall: null },
    { leadId: "newer", assignedAgentId: "a2", createdAt: "2026-11-01T00:00:00Z", lastCall: null },
  ])
  check("match: never called -> newest lead, its assigned agent", none?.leadId === "newer" && none?.agentId === "a2")
  check("match: no candidates -> unknown caller", pickCallbackLead([]) === null)
}

// ── Business hours ───────────────────────────────────────────────────────────

{
  const h: BusinessHours = { enabled: true, timezone: "America/Chicago", openDays: [1, 2, 3, 4, 5], openTime: "09:00", closeTime: "17:00" }
  // 2026-11-17 is a Tuesday; Chicago is UTC-6 in November.
  check("hours: Tue 10:00 CT is open", isWithinBusinessHours(h, new Date("2026-11-17T16:00:00Z")))
  check("hours: Tue 08:59 CT is closed", !isWithinBusinessHours(h, new Date("2026-11-17T14:59:00Z")))
  check("hours: Tue 17:00 CT is closed (close is exclusive)", !isWithinBusinessHours(h, new Date("2026-11-17T23:00:00Z")))
  check("hours: Sat noon is closed", !isWithinBusinessHours(h, new Date("2026-11-21T18:00:00Z")))
  check("hours: switched off = always open", isWithinBusinessHours({ ...h, enabled: false }, new Date("2026-11-21T18:00:00Z")))
  const night = { ...h, openTime: "20:00", closeTime: "02:00" }
  check("hours: overnight window wraps midnight", isWithinBusinessHours(night, new Date("2026-11-18T07:00:00Z"))) // Wed 01:00 CT
}

// ── Forward hang-up causes ────────────────────────────────────────────────────

check("forward: timeout = no answer", forwardMissReason("timeout") === "no_answer")
check("forward: user_busy = busy", forwardMissReason("user_busy") === "busy")
check("forward: call_rejected = declined", forwardMissReason("call_rejected") === "declined")
check("forward: originator_cancel = caller hung up", forwardMissReason("originator_cancel") === "caller_hung_up")
check("forward: anything else = failed", forwardMissReason("unallocated_number") === "forward_failed")

// ── Voicemail script ─────────────────────────────────────────────────────────

{
  const s = voicemailScript({ brokerName: "Acme Freight", agentFirstName: "Sara", callbackNumber: "(214) 286-5022" })
  check("script: fills broker, agent, number twice", s.startsWith("Hi Acme Freight, this is Sara from Loadlinkers.") && s.split("(214) 286-5022").length === 3)
}

// ── Webhook flow (fake DB + fake Telnyx) ─────────────────────────────────────

interface Row extends CallbackRow {
  caller_number: string | null
  agent_id: string | null
  forward_to?: string | null
  forward_call_control_id?: string | null
  answered_at?: string | null
  greeting_started_at?: string | null
  recording_seconds?: number | null
  transcript?: string | null
  transcript_status?: string | null
}

const OPEN: BusinessHours = { enabled: false, timezone: "America/Chicago", openDays: [], openTime: "09:00", closeTime: "17:00" }

function harness(settings: Partial<InboundSettings> = {}, over: Partial<InboundDeps> = {}) {
  const rows: Row[] = []
  const cmds: string[] = []
  const notified: string[] = []
  let n = 0
  const deps: InboundDeps = {
    async findByCallControlId(id) { return rows.find((r) => r.call_control_id === id) ?? null },
    async findById(id) { return rows.find((r) => r.id === id) ?? null },
    async insertCallback(r) {
      const hit = rows.find((x) => x.call_control_id === r.call_control_id)
      if (hit) return hit
      const row: Row = { id: `cb${++n}`, status: "ringing", missed_reason: null, ended_at: null, recording_started_at: null, recording_path: null, admin_notified_at: null, ...r }
      rows.push(row)
      return row
    },
    async updateCallback(id, patch, from?: CallbackStatus[]) {
      const r = rows.find((x) => x.id === id)
      if (!r || (from && !from.includes(r.status))) return null
      Object.assign(r, patch)
      return r
    },
    async claimNotification(id, at) {
      const r = rows.find((x) => x.id === id)
      if (!r || r.admin_notified_at) return false
      r.admin_notified_at = at
      return true
    },
    async matchCaller(e164) { return e164 === "+12145550147" ? { leadId: "lead1", agentId: "agent7" } : null },
    async loadSettings() {
      return { forwardTo: "+19725550100", ringTimeoutSecs: 20, greeting: DEFAULT_GREETING, hours: OPEN, ...settings }
    },
    async transfer(id, o) { cmds.push(`transfer ${id} ${o.to} ${o.timeoutSecs}s ${o.commandId}`) },
    async answer(id, c) { cmds.push(`answer ${id} ${c}`) },
    async speak(id, text, c) { cmds.push(`speak ${id} ${c}`) },
    async recordStart(id, c) { cmds.push(`record ${id} ${c}`) },
    async downloadRecording() { return new ArrayBuffer(8) },
    async uploadRecording() {},
    async transcribe() { return { text: "Hi this is Bob from Acme, call me back.", seconds: 7.4 } },
    async notifyAdmin(id) { notified.push(id) },
    ...over,
  }
  const fire = (event: string, payload: Record<string, unknown>, now = new Date("2026-11-17T16:00:00Z")) =>
    handleInboundEvent(event, { call_control_id: "A", ...payload }, deps, now)
  return { rows, cmds, notified, deps, fire }
}

const incoming = { direction: "incoming", from: "+12145550147", to: "+12142865022", call_session_id: "S1" }

async function main() {
  // 1) Ring, admin answers.
  {
    const h = harness()
    await h.fire("call.initiated", incoming)
    const row = h.rows[0]
    check("flow: callback row logged with lead + agent who last called", row?.lead_id === "lead1" && row.agent_id === "agent7" && row.caller_number === "+12145550147")
    check("flow: rings the admin's phone for the set time", h.cmds[0] === "transfer A +19725550100 20s cb-transfer" && row.status === "forwarding")
    const fwd = encodeForwardState(row.id)
    await h.fire("call.initiated", { call_control_id: "B", client_state: fwd, direction: "outgoing" })
    await h.fire("call.answered", { call_control_id: "B", client_state: fwd })
    check("flow: admin picks up -> answered", row.status === "answered" && !!row.answered_at && row.forward_call_control_id === "B")
    await h.fire("call.hangup", { call_control_id: "B", client_state: fwd, hangup_cause: "normal_clearing" })
    await h.fire("call.hangup", { hangup_cause: "normal_clearing" })
    check("flow: answered call ends -> stays answered, no voicemail, no email", row.status === "answered" && !h.cmds.some((c) => c.startsWith("answer")) && h.notified.length === 0)
  }

  // 2) Ring, no answer -> greeting -> beep -> voicemail -> transcript -> one email.
  {
    const h = harness()
    await h.fire("call.initiated", incoming)
    await h.fire("call.initiated", incoming) // Telnyx retry
    check("idempotent: a retried call.initiated makes no second row or transfer", h.rows.length === 1 && h.cmds.filter((c) => c.startsWith("transfer")).length === 1)
    const row = h.rows[0]
    const fwd = encodeForwardState(row.id)
    await h.fire("call.hangup", { call_control_id: "B", client_state: fwd, hangup_cause: "timeout" })
    check("no answer: marked missed (no_answer) and the caller is answered for voicemail", row.status === "missed" && row.missed_reason === "no_answer" && h.cmds.includes("answer A cb-answer"))
    await h.fire("call.answered", {})
    check("no answer: greeting plays on our answer", h.cmds.includes("speak A cb-greeting"))
    await h.fire("call.speak.ended", {})
    check("no answer: recording starts after the greeting", h.cmds.includes("record A cb-record") && !!row.recording_started_at)
    await h.fire("call.hangup", { hangup_cause: "normal_clearing" })
    check("no answer: hang-up with a recording running waits for the recording (no email yet)", h.notified.length === 0)
    const saved = { recording_urls: { mp3: "https://x/rec.mp3" }, recording_started_at: "2026-11-17T16:00:10Z", recording_ended_at: "2026-11-17T16:00:22Z" }
    await h.fire("call.recording.saved", saved)
    check("voicemail: stored, 12 s, transcript saved, status voicemail", row.status === "voicemail" && row.recording_path === voicemailPath(row.id, new Date("2026-11-17T16:00:00Z")) && row.recording_seconds === 12 && row.transcript_status === "done" && !!row.transcript)
    check("voicemail: admin notified once", h.notified.length === 1)
    await h.fire("call.recording.saved", saved)
    check("idempotent: a retried recording.saved stores and emails nothing again", h.notified.length === 1)
  }

  // 3) Busy / declined.
  for (const [cause, reason] of [["user_busy", "busy"], ["call_rejected", "declined"]] as const) {
    const h = harness()
    await h.fire("call.initiated", incoming)
    await h.fire("call.hangup", { call_control_id: "B", client_state: encodeForwardState(h.rows[0].id), hangup_cause: cause })
    check(`${reason}: falls back to voicemail`, h.rows[0].missed_reason === reason && h.cmds.includes("answer A cb-answer"))
  }

  // 4) Outside business hours: never rings the phone.
  {
    const h = harness({ hours: { enabled: true, timezone: "America/Chicago", openDays: [1, 2, 3, 4, 5], openTime: "09:00", closeTime: "17:00" } })
    await h.fire("call.initiated", incoming, new Date("2026-11-17T04:00:00Z")) // Mon 22:00 CT
    check("after hours: straight to voicemail, no transfer", h.rows[0].missed_reason === "after_hours" && !h.cmds.some((c) => c.startsWith("transfer")) && h.cmds.includes("answer A cb-answer"))
  }

  // 5) No forwarding number set.
  {
    const h = harness({ forwardTo: null })
    await h.fire("call.initiated", incoming)
    check("no forwarding number: straight to voicemail", h.rows[0].missed_reason === "no_forward_number" && h.cmds.includes("answer A cb-answer"))
  }

  // 6) Transfer command rejected by Telnyx.
  {
    const h = harness({}, { transfer: async () => { throw new Error("422") } })
    await h.fire("call.initiated", incoming)
    check("transfer error: falls back to voicemail", h.rows[0].missed_reason === "forward_failed" && h.cmds.includes("answer A cb-answer"))
  }

  // 7) Caller hangs up while the phone rings: missed, one email, no voicemail attempt.
  {
    const h = harness()
    await h.fire("call.initiated", incoming)
    await h.fire("call.hangup", { hangup_cause: "normal_clearing" })
    await h.fire("call.hangup", { call_control_id: "B", client_state: encodeForwardState(h.rows[0].id), hangup_cause: "originator_cancel" })
    check("caller hung up: missed + one email + no answer command", h.rows[0].status === "missed" && h.rows[0].missed_reason === "caller_hung_up" && h.notified.length === 1 && !h.cmds.some((c) => c.startsWith("answer")))
  }

  // 8) Out-of-order: forward leg's originator_cancel first, then the caller's hang-up.
  {
    const h = harness()
    await h.fire("call.initiated", incoming)
    await h.fire("call.hangup", { call_control_id: "B", client_state: encodeForwardState(h.rows[0].id), hangup_cause: "originator_cancel" })
    await h.fire("call.hangup", { hangup_cause: "originator_cancel" })
    check("out of order: still exactly one missed email", h.rows[0].missed_reason === "caller_hung_up" && h.notified.length === 1)
  }

  // 9) Unknown caller is still logged.
  {
    const h = harness()
    await h.fire("call.initiated", { ...incoming, from: "+13125550199" })
    check("unknown caller: logged with no lead", h.rows.length === 1 && h.rows[0].lead_id === null && h.rows[0].caller_number === "+13125550199")
  }

  // 10) Outbound calls on the same app are ignored; events for unknown calls are harmless.
  {
    const h = harness()
    const r = await h.fire("call.initiated", { ...incoming, direction: "outgoing" })
    const r2 = await h.fire("call.hangup", { call_control_id: "ZZZ" })
    check("ignores outbound + unknown calls", r.ok && r2.ok && h.rows.length === 0 && h.cmds.length === 0)
  }

  // 11) Transcription failing still keeps the voicemail and emails the admin.
  {
    const h = harness({}, { transcribe: async () => { throw new Error("deepgram down") } })
    await h.fire("call.initiated", incoming)
    await h.fire("call.hangup", { call_control_id: "B", client_state: encodeForwardState(h.rows[0].id), hangup_cause: "timeout" })
    await h.fire("call.answered", {})
    await h.fire("call.speak.ended", {})
    const r = await h.fire("call.recording.saved", { recording_urls: { mp3: "https://x/rec.mp3" } })
    check("transcript failure: voicemail kept, marked failed, email sent, webhook 200", r.ok && h.rows[0].status === "voicemail" && h.rows[0].transcript_status === "failed" && h.notified.length === 1)
  }

  // 12) Storage failure asks Telnyx to retry (non-2xx), nothing half-saved.
  {
    const h = harness({}, { uploadRecording: async () => { throw new Error("storage down") } })
    await h.fire("call.initiated", incoming)
    const r = await h.fire("call.recording.saved", { recording_urls: { mp3: "https://x/rec.mp3" } })
    check("storage failure: returns error so Telnyx retries", !r.ok && h.rows[0].recording_path === null)
  }

  check("forward state round-trips and ignores foreign client_state", decodeForwardState(encodeForwardState("x1")) === "x1" && decodeForwardState(Buffer.from(JSON.stringify({ leadId: "l" })).toString("base64")) === null)

  // ── Badge + cooldown reset ─────────────────────────────────────────────────

  {
    const open = openCallbacksFrom(
      [
        { lead_id: "L1", status: "voicemail", received_at: "2026-11-17T10:00:00Z", handled_at: null },
        { lead_id: "L2", status: "missed", received_at: "2026-11-17T10:00:00Z", handled_at: "2026-11-17T11:00:00Z" },
        { lead_id: "L3", status: "missed", received_at: "2026-11-17T10:00:00Z", handled_at: null },
      ],
      { L3: "2026-11-17T10:30:00Z" },
    )
    check("badge: open callback shows; handled or called-back-since does not", Object.keys(open).join() === "L1")
  }
  {
    const t = (hhmm: string) => new Date(`2026-11-17T${hhmm}:00Z`)
    const attempts = [{ at: t("10:00"), unanswered: true }, { at: t("10:10"), unanswered: true }]
    check("cooldown: two misses block", evaluateCooldown(attempts, t("10:20")).blocked)
    check("cooldown: a callback after them resets it", !evaluateCooldown(attempts, t("10:20"), t("10:15")).blocked)
    check("cooldown: tries after the callback count again", evaluateCooldown([...attempts, { at: t("10:30"), unanswered: true }, { at: t("10:40"), unanswered: true }], t("10:45"), t("10:15")).blocked)
  }

  // ── Email ──────────────────────────────────────────────────────────────────

  {
    const e = callbackEmail({ status: "voicemail", missedReason: "no_answer", receivedAt: "2026-11-17T16:00:00Z", callerNumber: "+12145550147", companyName: "Acme", agentName: "Sara K", transcript: "call me", recordingSeconds: 12, link: "https://x/callbacks" })
    check("email: voicemail subject + transcript + link", e.subject === "New voicemail from Acme" && e.text.includes("call me") && e.text.includes("https://x/callbacks"))
  }

  // ── Agents never see numbers ───────────────────────────────────────────────

  {
    const sql = read("supabase/migrations/20261117000001_inbound_callbacks.sql")
    const grant = /grant select \(([^)]*)\) on public\.callbacks to authenticated/.exec(sql)?.[1] ?? ""
    check("RLS: agents read only their own leads' callbacks", /lead_id in \(select l\.id from public\.leads l where l\.assigned_agent_id = public\.current_agent_id\(\)\)/.test(sql))
    check("RLS: caller/forward numbers are not granted to signed-in users", !!grant && !/caller_number|to_number|forward_to/.test(grant) && /revoke all on public\.callbacks from anon, authenticated/.test(sql))
    check("RLS: settings (admin's mobile) are admin only", /inbound_call_settings for all to authenticated\s+using \(public\.is_admin\(\)\)/.test(sql))
    const page = read("app/(dashboard)/callbacks/page.tsx")
    const agentBranch = page.slice(page.indexOf("} else {"))
    const agentSelect = /\.select\("([^"]*)"\)/.exec(agentBranch)?.[1] ?? ""
    check("agent page never selects caller_number", !!agentSelect && !/caller_number|to_number|forward_to/.test(agentSelect) && /caller: null/.test(agentBranch))
  }

  // ── Signature ──────────────────────────────────────────────────────────────

  {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519")
    const rawKey = publicKey.export({ format: "der", type: "spki" }).subarray(12).toString("base64")
    const now = new Date("2026-11-17T16:00:00Z")
    const ts = String(Math.floor(now.getTime() / 1000))
    const body = JSON.stringify({ data: { event_type: "call.initiated", payload: incoming } })
    const sig = sign(null, Buffer.from(`${ts}|${body}`), privateKey).toString("base64")
    check("signature: a real one passes", inboundSignatureProblem(body, sig, ts, rawKey, now) === null)
    check("signature: a changed body fails", inboundSignatureProblem(body.replace("incoming", "outgoing"), sig, ts, rawKey, now) !== null)
    check("signature: replayed old event fails", inboundSignatureProblem(body, sig, ts, rawKey, new Date(now.getTime() + 600_000)) !== null)
    check("signature: missing headers fail", inboundSignatureProblem(body, null, ts, rawKey, now) !== null)
    check("signature: no public key configured fails closed", inboundSignatureProblem(body, sig, ts, undefined, now) !== null)
    const route = read("app/api/telnyx/inbound/route.ts")
    check("route: a bad signature is always rejected (401), before any DB work", /if \(problem\) \{[\s\S]*?status: 401/.test(route) && route.indexOf("status: 401") < route.indexOf("handleInboundEvent(event"))
  }

  console.log(failed === 0 ? "\nAll passed" : `\n${failed} FAILED`)
  process.exit(failed === 0 ? 0 : 1)
}

main()
