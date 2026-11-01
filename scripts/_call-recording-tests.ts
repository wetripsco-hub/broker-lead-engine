// Agent call recording: webhook flow, who may listen, Call Reviews filters, signature check.
//   npx tsx scripts/_call-recording-tests.ts
import { generateKeyPairSync, sign } from "crypto"
import { readFileSync } from "fs"
import {
  decodeClientState,
  handleCallEvent,
  hangupStatus,
  recordingPath,
  recordingSeconds,
  type CallEventDeps,
  type CallRow,
} from "../lib/telnyx/call-events"
import { isValidTelnyxSignature } from "../lib/telnyx/webhook-signature"
import { resolveRecordingUrl, type RecordingAccessDeps } from "../lib/calls/recording-access"
import { callFiltersQuery, callSeconds, formatCallDuration, formatPktTime, outcomeLabel, parseCallFilters, rangeStart } from "../lib/calls/review"
import { CALL_SCRIPT } from "../lib/call-script/script"

export {}
let failed = 0
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` (${extra})` : ""}`)
  if (!ok) failed++
}
const read = (p: string) => readFileSync(p, "utf8")
const state = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64")

interface Row extends CallRow { external_id: string | null; agent_id: string; recording_seconds?: number | null }

function fakeDb(rows: Row[], over: Partial<CallEventDeps> = {}) {
  const log = { recordings: 0, uploads: [] as string[], inserts: 0, downloads: 0 }
  const deps: CallEventDeps = {
    async findByExternalId(id) { return rows.find((r) => r.external_id === id) ?? null },
    async linkEvent(eventId, agentId, id) {
      const row = rows.find((r) => r.id === eventId && r.agent_id === agentId && r.external_id === null)
      if (!row) return null
      row.external_id = id
      return row
    },
    async insertLegacyRow() { log.inserts++ },
    async updateStatus(id, status) {
      const row = rows.find((r) => r.id === id)!
      if (row.disposition === null) row.status = status
    },
    async startRecording() { log.recordings++ },
    async downloadRecording() { log.downloads++; return new ArrayBuffer(4) },
    async uploadRecording(path) { log.uploads.push(path) },
    async saveRecording(id, path, seconds) {
      const row = rows.find((r) => r.id === id)!
      row.recording_path = path
      row.recording_seconds = seconds
    },
    ...over,
  }
  return { deps, log }
}
const dialerRow = (over: Partial<Row> = {}): Row => ({ id: "E1", agent_id: "A1", external_id: null, status: "pending", disposition: null, recording_path: null, ...over })
const client = state({ leadId: "L1", agentId: "A1", eventId: "E1" })
const saved = { call_control_id: "C1", client_state: client, recording_urls: { mp3: "https://s3/x.mp3" }, public_recording_urls: {}, recording_started_at: "2026-11-01T10:00:00Z", recording_ended_at: "2026-11-01T10:00:42Z" }

async function main() {
  // ── §1: one row per call ───────────────────────────────────────────────────
  {
    const rows = [dialerRow()]
    const { deps, log } = fakeDb(rows)
    await handleCallEvent("call.initiated", { call_control_id: "C1", client_state: client }, deps)
    check("initiated: links the dialer's row, no second row", rows.length === 1 && rows[0].external_id === "C1" && log.inserts === 0)
    await handleCallEvent("call.initiated", { call_control_id: "C1", client_state: client }, deps)
    check("initiated: a retried event changes nothing", log.inserts === 0 && rows[0].external_id === "C1")
  }
  {
    const { deps, log } = fakeDb([])
    await handleCallEvent("call.initiated", { call_control_id: "C9", client_state: state({ leadId: "L1", agentId: "A1" }) }, deps)
    check("initiated: tabs on the old version (no eventId) still get a row", log.inserts === 1)
    await handleCallEvent("call.initiated", { call_control_id: "C9", client_state: client }, deps)
    check("initiated: an eventId that doesn't match never inserts", log.inserts === 1)
  }
  {
    const rows = [dialerRow({ agent_id: "A2" })]
    const { deps } = fakeDb(rows)
    await handleCallEvent("call.initiated", { call_control_id: "C1", client_state: client }, deps)
    check("initiated: another agent's row can't be linked", rows[0].external_id === null)
    const taken = [dialerRow({ external_id: "OTHER" })]
    await handleCallEvent("call.initiated", { call_control_id: "C1", client_state: client }, fakeDb(taken).deps)
    check("initiated: an already linked row keeps its call", taken[0].external_id === "OTHER")
  }

  // ── §2: recording starts on answer ─────────────────────────────────────────
  {
    const rows = [dialerRow()]
    const { deps, log } = fakeDb(rows)
    await handleCallEvent("call.answered", { call_control_id: "C1", client_state: client }, deps)
    check("answered: arriving before initiated still finds the row and records", rows[0].status === "answered" && rows[0].external_id === "C1" && log.recordings === 1)
  }
  {
    const rows = [dialerRow({ external_id: "C1" })]
    const res = await handleCallEvent("call.answered", { call_control_id: "C1" }, fakeDb(rows, { startRecording: async () => { throw new Error("nope") } }).deps)
    check("answered: a recording error doesn't fail the webhook", res.ok && rows[0].status === "answered")
  }
  {
    const { deps, log } = fakeDb([])
    await handleCallEvent("call.answered", { call_control_id: "RETELL" }, deps)
    check("answered: a call with no agent row (AI calls) is never recorded", log.recordings === 0)
  }
  check("recording: dual channel, mp3, no beep, retry-safe", /format: "mp3"/.test(read("lib/telnyx/client.ts")) && /channels: "dual"/.test(read("lib/telnyx/client.ts")) && /play_beep: false/.test(read("lib/telnyx/client.ts")) && /command_id/.test(read("lib/telnyx/client.ts")))

  // ── Hang-up ────────────────────────────────────────────────────────────────
  check("hangup: normal end -> answered", hangupStatus("normal_clearing", "pending") === "answered")
  check("hangup: unanswered -> no_answer", hangupStatus("originator_cancel", "pending") === "no_answer" && hangupStatus("timeout", "pending") === "no_answer")
  check("hangup: an answered call stays answered", hangupStatus("user_busy", "answered") === "answered")
  {
    const rows = [dialerRow({ external_id: "C1", status: "answered", disposition: "left_voicemail" })]
    await handleCallEvent("call.hangup", { call_control_id: "C1", hangup_cause: "normal_clearing" }, fakeDb(rows).deps)
    check("hangup: never overwrites a saved outcome", rows[0].status === "answered" && rows[0].disposition === "left_voicemail")
  }

  // ── §3: storing the file ───────────────────────────────────────────────────
  check("path: year/month/event", recordingPath("E1", new Date("2026-03-05T00:00:00Z")) === "2026/03/E1.mp3")
  check("seconds: from the two timestamps, null when missing", recordingSeconds("2026-11-01T10:00:00Z", "2026-11-01T10:00:42Z") === 42 && recordingSeconds(undefined, "x") === null)
  check("client_state: malformed is ignored", decodeClientState("%%%").eventId === null && decodeClientState(client).eventId === "E1")
  {
    const rows = [dialerRow({ external_id: "C1" })]
    const { deps, log } = fakeDb(rows)
    const res = await handleCallEvent("call.recording.saved", saved, deps, new Date("2026-11-01T10:01:00Z"))
    check("saved: stored under the event id, path and seconds on the row", res.ok && log.uploads[0] === "2026/11/E1.mp3" && rows[0].recording_path === "2026/11/E1.mp3" && rows[0].recording_seconds === 42)
    await handleCallEvent("call.recording.saved", saved, deps)
    check("saved: a retry doesn't download again", log.downloads === 1)
  }
  {
    const rows = [dialerRow({ external_id: "C1" })]
    const seen: string[] = []
    const { deps } = fakeDb(rows, { downloadRecording: async (u) => { seen.push(u); return new ArrayBuffer(1) } })
    await handleCallEvent("call.recording.saved", { ...saved, recording_urls: {}, public_recording_urls: { mp3: "https://pub/x.mp3" } }, deps)
    check("saved: falls back to the public link", seen[0] === "https://pub/x.mp3")
  }
  {
    const rows = [dialerRow({ external_id: "C1" })]
    const res = await handleCallEvent("call.recording.saved", saved, fakeDb(rows, { downloadRecording: async () => { throw new Error("403") } }).deps)
    check("saved: a failed download returns an error so Telnyx retries", !res.ok && rows[0].recording_path === null)
    const res2 = await handleCallEvent("call.recording.saved", saved, fakeDb(rows, { uploadRecording: async () => { throw new Error("full") } }).deps)
    check("saved: a failed upload returns an error too", !res2.ok && rows[0].recording_path === null)
  }
  {
    const res = await handleCallEvent("call.recording.saved", saved, fakeDb([]).deps)
    check("saved: an unknown call is acknowledged, not retried forever", res.ok)
  }

  // ── Who may listen ─────────────────────────────────────────────────────────
  {
    const access = (over: Partial<RecordingAccessDeps> = {}): RecordingAccessDeps => ({
      userId: async () => "U1",
      readEvent: async () => ({ agent_id: "A1", recording_path: "2026/11/E1.mp3" }),
      isAdmin: async () => false,
      ownAgentId: async () => "A1",
      signUrl: async () => "https://signed",
      ...over,
    })
    check("access: agent, own call -> signed link", (await resolveRecordingUrl("E1", false, access())).url === "https://signed")
    check("access: agent, another agent's call on a reassigned lead -> refused", !(await resolveRecordingUrl("E1", false, access({ ownAgentId: async () => "A2" }))).url)
    check("access: row hidden by RLS -> refused", !(await resolveRecordingUrl("E1", false, access({ readEvent: async () => null }))).url)
    check("access: no agent record -> refused", !(await resolveRecordingUrl("E1", false, access({ ownAgentId: async () => null }))).url)
    check("access: signed out -> refused", (await resolveRecordingUrl("E1", false, access({ userId: async () => null }))).error === "Not authenticated")
    check("access: admin, anyone's call -> signed link", (await resolveRecordingUrl("E1", false, access({ isAdmin: async () => true, ownAgentId: async () => "A2" }))).url === "https://signed")
    check("access: no recording -> nothing to sign", !(await resolveRecordingUrl("E1", false, access({ readEvent: async () => ({ agent_id: "A1", recording_path: null }) }))).url)
  }
  {
    const actions = read("app/(dashboard)/calls/actions.ts")
    check("action: the row is read with the user's session", /\(supabase\.from\("outreach_events"\)/.test(actions) && !/admin\.from/.test(actions))
    const page = read("app/(dashboard)/calls/page.tsx")
    check("page: admin only, role read from the database", /isAdminInDb\(createAdminClient\(\), user\.id\)\)\) redirect\("\/leads"\)/.test(page))
    check("page: data goes through the user's session", /\(supabase\.from\("outreach_events"\) as any\)/.test(page))
    const migration = read("supabase/migrations/20261101000001_call_recordings.sql")
    check("bucket: private, no storage policies", /'call-recordings', false/.test(migration) && !/create policy/i.test(migration))
  }

  // ── §4: Call Reviews ───────────────────────────────────────────────────────
  {
    const f = parseCallFilters({ agent: "not-a-uuid", range: "bad", outcome: "bad", page: "-2", recording: "no" })
    check("filters: junk values fall back", f.agent === null && f.range === "all" && f.outcome === null && f.page === 1 && !f.recording)
    const good = parseCallFilters({ agent: "58ea9fa8-6da3-4a1a-82df-69ff11e30790", range: "week", outcome: "demo_booked", page: "3", recording: "yes" })
    check("filters: valid values are kept", good.range === "week" && good.outcome === "demo_booked" && good.page === 3 && good.recording)
    check("filters: changing a filter goes back to page 1", !callFiltersQuery(good, { range: "today" }).includes("page=") && callFiltersQuery(good, { page: 4 }).includes("page=4"))
    // 2026-11-01 is a Sunday; 20:00 UTC is already Monday 01:00 in Pakistan.
    const now = new Date("2026-11-01T20:00:00Z")
    check("range: today starts at midnight PKT", rangeStart("today", now)!.toISOString() === "2026-11-01T19:00:00.000Z")
    check("range: this week starts Monday PKT", rangeStart("week", now)!.toISOString() === "2026-11-01T19:00:00.000Z")
    check("range: Sunday PKT belongs to the week started the Monday before", rangeStart("week", new Date("2026-11-01T10:00:00Z"))!.toISOString() === "2026-10-25T19:00:00.000Z")
    check("range: all has no start", rangeStart("all", now) === null)
    check("duration: recording length wins, else the logged one", callSeconds({ recording_seconds: 42, message_body: "Duration: 40s" }) === 42 && callSeconds({ recording_seconds: null, message_body: "Disposition: x\nDuration: 95s" }) === 95 && callSeconds({ recording_seconds: null, message_body: null }) === null)
    check("duration: display", formatCallDuration(95) === "1m 35s" && formatCallDuration(42) === "42s" && formatCallDuration(null) === "—")
    check("outcome: label, and old rows without one", outcomeLabel("trial_link_sent") === "Trial link sent" && outcomeLabel(null) === "Not saved")
    check("time: shown in PKT", formatPktTime("2026-11-01T19:30:00Z") === "Nov 2, 12:30 AM PKT", formatPktTime("2026-11-01T19:30:00Z"))
  }

  // ── §5 and §6 ──────────────────────────────────────────────────────────────
  {
    const dialer = read("components/leads/dialer-modal.tsx")
    check("dialer: eventId goes in client_state", /btoa\(JSON\.stringify\(\{ leadId, agentId, eventId: eventIdRef\.current \}\)\)/.test(dialer))
    check("dialer: answered call has no close or skip until a save fails", /canSkip\s+= phase === "ended" && \(!answered \|\| saveFailed\)/.test(dialer) && !/\{isEnded && \(\s*<button\s+onClick=\{onClose\}/.test(dialer))
    check("dialer: default outcome doesn't read a stale timer", /answeredRef\.current \? "not_interested" : "no_answer"/.test(dialer))
    check("direct dialer: eventId goes in client_state", /eventId: eventIdRef\.current/.test(read("components/dialer/dialer-widget.tsx")))
    const disclosure = "this call may be recorded for quality"
    const opener = (section: string, item: string) => CALL_SCRIPT.find((s) => s.id === section)!.items.find((i) => i.id === item)!.lines[0].text
    check("script: all three openers carry the disclosure", [opener("opener", "opener-main"), opener("marketplace-first", "mpf-opener"), opener("short", "short-opener")].every((t) => t.includes(disclosure)))
    check("script: the doc says the same", (read("doc/loadlinkers-call-script.md").match(new RegExp(disclosure, "g")) ?? []).length === 3)
    const webhook = read("app/api/telnyx/webhook/route.ts")
    check("webhook: 60 second limit, recording failures become a non-2xx", /export const maxDuration = 60/.test(webhook) && /status: 500/.test(webhook))
  }

  // ── §7: signature ──────────────────────────────────────────────────────────
  {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519")
    const rawKey = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64")
    const body = '{"data":{"event_type":"call.answered"}}'
    const ts = "1793500000"
    const now = new Date(1793500000 * 1000)
    const sig = sign(null, Buffer.from(`${ts}|${body}`), privateKey).toString("base64")
    check("signature: a real one passes", isValidTelnyxSignature(body, sig, ts, rawKey, now))
    check("signature: a changed body fails", !isValidTelnyxSignature(body + " ", sig, ts, rawKey, now))
    check("signature: a replayed old event fails", !isValidTelnyxSignature(body, sig, ts, rawKey, new Date(now.getTime() + 600_000)))
    check("signature: missing headers fail", !isValidTelnyxSignature(body, null, ts, rawKey, now) && !isValidTelnyxSignature(body, sig, null, rawKey, now))
    check("signature: a bad key fails without throwing", !isValidTelnyxSignature(body, sig, ts, "bm90LWEta2V5", now))
    const route = read("app/api/telnyx/webhook/route.ts")
    check("webhook: a bad signature is only rejected when enforcing is switched on", /TELNYX_WEBHOOK_ENFORCE === "true"\) \{\s+return NextResponse\.json\(\{ error: "Invalid signature" \}, \{ status: 401 \}\)/.test(route) && (route.match(/status: 401/g) ?? []).length === 1)
  }

  console.log(failed === 0 ? "\nAll passed" : `\n${failed} FAILED`)
  process.exit(failed === 0 ? 0 : 1)
}

main()
