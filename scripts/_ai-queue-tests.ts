// Offline checks for the AI auto-dial queue. No network, no phone, no waiting.
//   npx tsx scripts/_ai-queue-tests.ts
import { readFileSync } from "fs"
import { MAX_QUEUE, runAiCallQueue, summarise, type CallSnapshot, type QueueDeps, type QueueItem, type StartResult } from "../lib/ai-call-queue"

export {}
let failed = 0
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  — ${extra}` : ""}`)
  if (!ok) failed++
}

const lead = (n: number) => ({ leadId: `L${n}`, label: `Broker ${n}`, status: "waiting" as const })
const leads = (n: number): QueueItem[] => Array.from({ length: n }, (_, i) => lead(i + 1))
const ended = (over: Partial<CallSnapshot> = {}): CallSnapshot => ({ call_status: "ended", status: "answered", duration_seconds: 42, disposition: "answered_interested", sentiment: "positive", ai_summary: "Wants a call.", ...over })

interface Harness { deps: QueueDeps; events: string[]; maxLive: () => number }
function harness(opts: {
  start?: (id: string) => StartResult | Promise<StartResult>
  snaps?: (eventId: string, poll: number) => CallSnapshot | null
  gapMs?: number; pollMs?: number; maxWaitMs?: number
} = {}): Harness {
  const events: string[] = []
  let live = 0, maxLive = 0
  const polls = new Map<string, number>()
  const deps: QueueDeps = {
    async startCall(id) {
      const r = await (opts.start ? opts.start(id) : { ok: true as const, eventId: `E-${id}` })
      if (r.ok) { live++; maxLive = Math.max(maxLive, live); events.push(`start ${id}`) } else events.push(`blocked ${id}`)
      return r
    },
    async getCall(eventId) {
      const n = (polls.get(eventId) ?? 0) + 1
      polls.set(eventId, n)
      const snap = opts.snaps ? opts.snaps(eventId, n) : n >= 2 ? ended() : { ...ended(), call_status: "in_progress" }
      if (snap && (snap.call_status === "ended" || snap.call_status === "failed")) { live--; events.push(`end ${eventId.slice(2)}`) }
      return snap
    },
    async sleep(ms) { events.push(`sleep ${ms}`) },
    gapMs: opts.gapMs ?? 15_000, pollMs: opts.pollMs ?? 4_000, maxWaitMs: opts.maxWaitMs ?? 60_000,
  }
  return { deps, events, maxLive: () => maxLive }
}

async function main() {
  // one at a time, in order
  {
    const h = harness()
    const out = await runAiCallQueue(leads(3), h.deps, () => {}, () => false)
    check("order: calls go L1, L2, L3", h.events.filter((e) => e.startsWith("start")).join() === "start L1,start L2,start L3")
    check("one at a time: never two calls live at once", h.maxLive() === 1)
    check("each call ends before the next one starts", h.events.filter((e) => /^(start|end)/.test(e)).join() === "start L1,end L1,start L2,end L2,start L3,end L3")
    check("all three finished as done, with the result noted", out.every((i) => i.status === "done" && i.durationSeconds === 42 && i.disposition === "answered_interested" && i.summary === "Wants a call."))
    check("gap between calls (2 gaps for 3 calls, none after the last)", h.events.filter((e) => e === "sleep 15000").length === 2)
    const s = summarise(out)
    check("summary counts", s.total === 3 && s.called === 3 && s.answered === 3 && s.skipped === 0 && s.failed === 0)
  }

  // a blocked lead is skipped with its reason, the queue goes on
  {
    const h = harness({ start: (id) => (id === "L2" ? { ok: false, error: "No AI-call consent is recorded for this lead.", code: "no_consent", status: 409 } : { ok: true, eventId: `E-${id}` }) })
    const out = await runAiCallQueue(leads(3), h.deps, () => {}, () => false)
    check("no consent: that lead is skipped with the server's reason", out[1].status === "skipped" && /consent/.test(out[1].detail ?? ""))
    check("no consent: the other leads are still called", out[0].status === "done" && out[2].status === "done")
    for (const [code, msg] of [["outside_hours", "outside 8 AM-6 PM"], ["dnc_list", "on the do-not-call list"], ["test_mode", "test mode"], ["active_call", "already in progress"], ["do_not_call", "marked do-not-call"]] as const) {
      const hh = harness({ start: (id) => (id === "L1" ? { ok: false, error: msg, code, status: 409 } : { ok: true, eventId: `E-${id}` }) })
      const o = await runAiCallQueue(leads(2), hh.deps, () => {}, () => false)
      check(`${code}: skipped, queue continues`, o[0].status === "skipped" && o[1].status === "done")
    }
  }

  // problems that affect every lead stop the whole queue
  for (const code of ["daily_cap", "disabled", "not_configured"]) {
    const h = harness({ start: (id) => (id === "L2" ? { ok: false, error: "stop", code, status: 409 } : { ok: true, eventId: `E-${id}` }) })
    const out = await runAiCallQueue(leads(4), h.deps, () => {}, () => false)
    check(`${code}: queue stops, remaining leads are not called`, out[0].status === "done" && out[1].status === "skipped" && out[2].status === "stopped" && out[3].status === "stopped" && !h.events.includes("start L3"))
  }
  {
    const h = harness({ start: (id) => (id === "L1" ? { ok: false, error: "Not signed in", status: 401 } : { ok: true, eventId: `E-${id}` }) })
    const out = await runAiCallQueue(leads(3), h.deps, () => {}, () => false)
    check("signed out mid-queue: stops everything", out[0].status === "skipped" && out[1].status === "stopped" && out[2].status === "stopped")
  }
  {
    const h = harness({ start: async () => { throw new Error("network") } })
    const out = await runAiCallQueue(leads(2), h.deps, () => {}, () => false)
    check("network error on start: lead skipped, queue goes on", out.every((i) => i.status === "skipped"))
  }

  // stop button
  {
    let stopNow = false
    const h = harness()
    const out = await runAiCallQueue(leads(3), h.deps, (items) => { if (items.some((i) => i.status === "done")) stopNow = true }, () => stopNow)
    check("stop: the call in progress finishes, the rest are not called", out[0].status === "done" && out[1].status === "stopped" && out[2].status === "stopped" && !h.events.includes("start L2"))
  }

  // results
  {
    const h = harness({ snaps: (_e, n) => (n >= 2 ? ended({ duration_seconds: 0, disposition: null, sentiment: null, ai_summary: null }) : null) })
    const out = await runAiCallQueue(leads(1), h.deps, () => {}, () => false)
    check("a call nobody answered is 'done' with 'No answer'", out[0].status === "done" && out[0].detail === "No answer" && summarise(out).answered === 0)
  }
  {
    const h = harness({ snaps: () => ({ ...ended(), call_status: "failed" }) })
    const out = await runAiCallQueue(leads(1), h.deps, () => {}, () => false)
    check("a failed call is marked failed", out[0].status === "failed")
  }
  {
    const h = harness({ snaps: () => ({ ...ended(), call_status: "in_progress" }), pollMs: 4000, maxWaitMs: 20_000 })
    const out = await runAiCallQueue(leads(2), h.deps, () => {}, () => false)
    check("no report ever arrives: gives up after the limit and moves on", out[0].status === "failed" && /No result received/.test(out[0].detail ?? "") && h.events.includes("start L2"))
    check("the wait is bounded (5 polls of 4s for a 20s limit)", h.events.filter((e) => e === "sleep 4000").length >= 5)
  }
  {
    const h = harness({ snaps: (_e, n) => { if (n === 1) throw new Error("blip"); return ended() } })
    const out = await runAiCallQueue(leads(1), h.deps, () => {}, () => false)
    check("a polling error is retried, not fatal", out[0].status === "done")
  }

  // limits + progress
  {
    const h = harness()
    const out = await runAiCallQueue(leads(MAX_QUEUE + 20), h.deps, () => {}, () => false)
    check(`at most ${MAX_QUEUE} leads per queue`, out.length === MAX_QUEUE && h.events.filter((e) => e.startsWith("start")).length === MAX_QUEUE)
  }
  {
    const snapshots: string[] = []
    const h = harness()
    await runAiCallQueue(leads(2), h.deps, (items) => snapshots.push(items.map((i) => i.status[0]).join("")), () => false)
    check("progress is reported step by step (waiting -> calling -> done)", snapshots[0] === "ww" && snapshots.some((x) => x === "cw") && snapshots.some((x) => x === "dc") && snapshots[snapshots.length - 1] === "dd")
  }

  // wiring
  const modal = readFileSync("components/leads/ai-call-queue-modal.tsx", "utf8")
  check("modal: each call goes through /api/ai-calls/start (all server guards apply)", /\/api\/ai-calls\/start/.test(modal))
  check("modal: never sends an hours override", !/hoursOverride\s*:\s*true/.test(modal) && /never an hours override/.test(modal))
  const start = readFileSync("app/api/ai-calls/start/route.ts", "utf8")
  check("server: the start route still runs the gate before any provider call", start.indexOf("evaluateAiCallGate(") > 0 && start.indexOf("evaluateAiCallGate(") < start.indexOf("provider.startCall("))
  const list = readFileSync("app/(dashboard)/leads/leads-list-client.tsx", "utf8")
  check("list: 'AI call all' sits in the selection bar", /AI call all/.test(list) && /aiQueueOpen/.test(list))

  console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) FAILED.`)
  process.exit(failed === 0 ? 0 : 1)
}
main()
