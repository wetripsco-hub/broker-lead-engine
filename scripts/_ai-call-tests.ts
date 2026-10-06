// Offline checks for AI calling — no network, no database, no real calls.
//   npx tsx scripts/_ai-call-tests.ts
import { createHmac } from "crypto"
import { evaluateAiCallGate, toE164, type GateInput } from "../lib/voice-agents/gate"
import { retellProvider } from "../lib/voice-agents/retell"
import { processVoiceEvent } from "../lib/voice-agents/process"

let failed = 0
function check(name: string, cond: boolean, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? `  — ${extra}` : ""}`)
  if (!cond) failed++
}

// ── 1. Gate ────────────────────────────────────────────────────────────────
const WED_10AM_ET = new Date("2026-10-07T14:00:00Z")
const WED_11PM_ET = new Date("2026-10-08T03:00:00Z")
const SAT_NOON_ET = new Date("2026-10-10T16:00:00Z")

const base: GateInput = {
  settings: { enabled: true, testMode: false, testNumbers: [], dailyCap: 20 },
  lead: { aiCallConsent: true, doNotCall: false, state: "NY", phone: "(212) 555-0100" },
  to: "+12125550100",
  onDncList: false,
  hasActiveCall: false,
  callsInLast24h: 0,
  now: WED_10AM_ET,
}
const code = (o: Omit<Partial<GateInput>, "lead" | "settings"> & { lead?: Partial<GateInput["lead"]>; settings?: Partial<GateInput["settings"]> }) => {
  const r = evaluateAiCallGate({
    ...base,
    ...o,
    lead: { ...base.lead, ...o.lead },
    settings: { ...base.settings, ...o.settings },
  })
  return r.ok ? "ok" : r.code
}

check("gate: all clear -> ok", code({}) === "ok")
check("gate: consent false -> blocked", code({ lead: { aiCallConsent: false } }) === "no_consent")
check("gate: master switch off -> blocked", code({ settings: { enabled: false } }) === "disabled")
check("gate: lead do_not_call -> blocked", code({ lead: { doNotCall: true } }) === "do_not_call")
check("gate: number on DNC list -> blocked", code({ onDncList: true }) === "dnc_list")
check("gate: 11 PM broker time -> blocked", code({ now: WED_11PM_ET }) === "outside_hours")
check("gate: weekend -> blocked", code({ now: SAT_NOON_ET }) === "weekend")
check("gate: unknown timezone -> blocked", code({ lead: { state: null, phone: "555" } }) === "unknown_timezone")
check("gate: active call -> blocked", code({ hasActiveCall: true }) === "active_call")
check("gate: daily cap reached -> blocked", code({ callsInLast24h: 20 }) === "daily_cap")
check("gate: test mode + number not whitelisted -> blocked", code({ settings: { testMode: true, testNumbers: ["+13215550123"] } }) === "test_mode")
check("gate: test mode + whitelisted -> ok", code({ settings: { testMode: true, testNumbers: ["+12125550100"] } }) === "ok")
check("gate: split-zone state near the edge is held back (FL at 8:30 AM ET)", code({ lead: { state: "FL", phone: null }, now: new Date("2026-10-07T12:30:00Z") }) !== "ok")
check("toE164 normalises", toE164("+1 (321) 848-4606") === "+13218484606" && toE164("abc") === null)

// ── 2. Retell signature ────────────────────────────────────────────────────
process.env.RETELL_API_KEY = "test-key-not-real"
const body = JSON.stringify({ event: "call_ended", call: { call_id: "c1" } })
const sign = (b: string, ts: number, key = "test-key-not-real") =>
  `v=${ts},d=${createHmac("sha256", key).update(b + ts).digest("hex")}`
const hdr = (v: string | null) => new Headers(v ? { "x-retell-signature": v } : {})
const now = Date.now()

check("signature: valid -> accepted", retellProvider.verifyWebhook(body, hdr(sign(body, now))))
check("signature: wrong key -> rejected", !retellProvider.verifyWebhook(body, hdr(sign(body, now, "other-key"))))
check("signature: tampered body -> rejected", !retellProvider.verifyWebhook(body + " ", hdr(sign(body, now))))
check("signature: missing header -> rejected", !retellProvider.verifyWebhook(body, hdr(null)))
check("signature: garbage header -> rejected", !retellProvider.verifyWebhook(body, hdr("nonsense")))
check("signature: 10-minute-old timestamp -> rejected", !retellProvider.verifyWebhook(body, hdr(sign(body, now - 10 * 60_000))))

// ── 3. Event normalisation ─────────────────────────────────────────────────
const analyzed = (custom: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  event: "call_analyzed",
  call: {
    call_id: "c-dnc",
    to_number: "+12125550100",
    metadata: { lead_id: "L1", agent_id: "A1", outreach_event_id: "E1" },
    call_analysis: { call_summary: "Short call.", user_sentiment: "Negative", custom_analysis_data: custom },
    ...extra,
  },
})

const flagged = retellProvider.normalizeEvent(analyzed({ do_not_call: true, interested: false }))
check("normalize: do_not_call flag -> doNotCall", flagged?.doNotCall === true && flagged.type === "analyzed")
const said = retellProvider.normalizeEvent(
  analyzed({ do_not_call: false }, { transcript: "User: please stop calling me\nAgent: Sorry about that." }),
)
check("normalize: 'stop calling me' in transcript -> doNotCall even if analysis missed it", said?.doNotCall === true)
const clean = retellProvider.normalizeEvent(analyzed({ do_not_call: false, interested: true, callback_time: "Friday 2pm" }))
check("normalize: normal call -> doNotCall false, fields carried", clean?.doNotCall === false && clean.callbackTime === "Friday 2pm" && clean.interested === true)
check("normalize: unrelated event -> null", retellProvider.normalizeEvent({ event: "transcript_updated", call: { call_id: "x" } }) === null)
const ended = retellProvider.normalizeEvent({ event: "call_ended", call: { call_id: "c1", duration_ms: 61_400, call_cost: { combined_cost: 1234 }, metadata: {} } })
check("normalize: ended -> seconds and USD", ended?.durationSeconds === 61 && ended.costUsd === 12.34)

// ── 4. Webhook processing against an in-memory DB ──────────────────────────
type Row = Record<string, any>
function fakeDb(tables: Record<string, Row[]>) {
  let n = 100
  const t = (name: string) => (tables[name] ??= [])
  const builder = (name: string) => {
    let mode: "select" | "update" | "upsert" = "select"
    let patch: Row = {}
    let filter: [string, any] | null = null
    let conflict: string | null = null
    let ignoreDup = false
    let upsertRow: Row = {}
    const match = (r: Row) => (filter ? r[filter[0]] === filter[1] : true)
    const run = () => {
      if (mode === "update") {
        t(name).filter(match).forEach((r) => Object.assign(r, patch))
        return { data: null, error: null }
      }
      if (mode === "upsert") {
        const existing = conflict ? t(name).find((r) => r[conflict!] === upsertRow[conflict!]) : undefined
        if (existing) {
          if (!ignoreDup) Object.assign(existing, upsertRow)
          return { data: existing, error: null }
        }
        const row = { id: `gen-${++n}`, ...upsertRow }
        t(name).push(row)
        return { data: row, error: null }
      }
      return { data: t(name).find(match) ?? null, error: null }
    }
    const b: any = {
      select: () => b,
      eq: (c: string, v: any) => ((filter = [c, v]), b),
      update: (p: Row) => ((mode = "update"), (patch = p), b),
      upsert: (r: Row, o?: { onConflict?: string; ignoreDuplicates?: boolean }) => (
        (mode = "upsert"), (upsertRow = r), (conflict = o?.onConflict ?? null), (ignoreDup = !!o?.ignoreDuplicates), b
      ),
      maybeSingle: async () => run(),
      single: async () => run(),
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    }
    return b
  }
  return { from: builder } as any
}

async function main() {
  const meta = { lead_id: "L1", agent_id: "A1", outreach_event_id: "E1" }

  // Duplicate delivery, and the webhook arriving before provider_call_id was saved.
  {
    const tables: Record<string, Row[]> = {
      outreach_events: [{ id: "E1", lead_id: "L1", agent_id: "A1", channel: "ai_call", call_status: "queued", provider_call_id: null }],
      leads: [{ id: "L1", do_not_call: false, brokers: { phone: "(212) 555-0100" } }],
      do_not_call_numbers: [],
    }
    const db = fakeDb(tables)
    const started = { type: "started", providerCallId: "call_1", metadata: meta, toNumber: null } as const
    const endedEv = { type: "ended", providerCallId: "call_1", metadata: meta, toNumber: null, durationSeconds: 42, transcript: "Agent: hi", recordingUrl: "https://r/x.wav", costUsd: 0.31 } as const
    await processVoiceEvent(db, "retell", started)
    await processVoiceEvent(db, "retell", endedEv)
    await processVoiceEvent(db, "retell", endedEv) // Retell retry
    await processVoiceEvent(db, "retell", started) // late duplicate of an earlier event
    const rows = tables.outreach_events
    check("idempotent: duplicate webhooks leave exactly one row", rows.length === 1)
    check("idempotent: row linked to provider call id via metadata", rows[0].provider_call_id === "call_1")
    check("idempotent: call_status never goes backwards (stays ended)", rows[0].call_status === "ended")
    check("ended: duration, transcript, recording, cost stored", rows[0].duration_seconds === 42 && rows[0].transcript === "Agent: hi" && rows[0].recording_url === "https://r/x.wav" && rows[0].cost_usd === 0.31)

    // "stop calling" analysis
    const dncEv = retellProvider.normalizeEvent(analyzed({ do_not_call: true, interested: false, callback_time: "tomorrow 3pm" }, { call_id: "call_1", metadata: meta }))!
    dncEv.providerCallId = "call_1"
    await processVoiceEvent(db, "retell", dncEv)
    await processVoiceEvent(db, "retell", dncEv)
    check("do_not_call analysis: lead flagged", tables.leads[0].do_not_call === true)
    check("do_not_call analysis: number added once to the DNC list", tables.do_not_call_numbers.length === 1 && tables.do_not_call_numbers[0].phone === "+12125550100")
    check("do_not_call analysis: disposition recorded", rows[0].disposition === "do_not_call")
    check("callback_time: follow-up date suggested", typeof rows[0].follow_up_date === "string" && rows[0].ai_callback_time === "tomorrow 3pm")
    check("callback_time: lead stage untouched", !("stage" in tables.leads[0]))
    check("still one row after analysis", rows.length === 1)
  }

  // Unknown call with metadata -> created once, even if delivered twice.
  {
    const tables: Record<string, Row[]> = { outreach_events: [], leads: [], do_not_call_numbers: [] }
    const db = fakeDb(tables)
    const ev = { type: "ended", providerCallId: "call_9", metadata: meta, toNumber: null, durationSeconds: 5 } as const
    await processVoiceEvent(db, "retell", ev)
    await processVoiceEvent(db, "retell", ev)
    check("unknown call + metadata: upserted to a single row", tables.outreach_events.length === 1)
    const r = await processVoiceEvent(db, "retell", { type: "ended", providerCallId: "call_x", metadata: {}, toNumber: null })
    check("unknown call without metadata: ignored", r.outcome === "ignored" && tables.outreach_events.length === 1)
  }

  console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) FAILED.`)
  process.exit(failed === 0 ? 0 : 1)
}

main()
