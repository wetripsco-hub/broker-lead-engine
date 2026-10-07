// Fills the E.164 columns for existing data, using the same lib/phone.ts the
// app uses. Dry run by default.
//
//   npx tsx --env-file=.env.local scripts/backfill-phone-e164.ts           # counts only
//   npx tsx --env-file=.env.local scripts/backfill-phone-e164.ts --apply   # writes
//
// Run AFTER supabase/migrations/20260930000001_phone_e164.sql (STEP 1).
// Never prints keys or phone numbers (only counts).

import { createClient } from "@supabase/supabase-js"
import { toE164 } from "../lib/phone"

const apply = process.argv.includes("--apply")
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing (use --env-file=.env.local).")
  process.exit(1)
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

const PAGE = 1000
const PARALLEL = 10

// Keyset paging on id: stable even though updates make rows drop out of the filter.
async function* pages<T extends { id: string }>(table: string, columns: string, filter: (q: any) => any): AsyncGenerator<T[]> {
  let last: string | null = null
  for (;;) {
    let q = filter(db.from(table).select(columns)).order("id", { ascending: true }).limit(PAGE)
    if (last) q = q.gt("id", last)
    const { data, error } = await q
    if (error) throw new Error(`${table}: ${error.message}`)
    if (!data || data.length === 0) return
    yield data as T[]
    if (data.length < PAGE) return
    last = (data[data.length - 1] as T).id
  }
}

async function runLimited<T>(items: T[], fn: (x: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += PARALLEL) await Promise.all(items.slice(i, i + PARALLEL).map(fn))
}

async function check(table: string, res: { error: { message: string } | null }) {
  if (res.error) throw new Error(`${table}: ${res.error.message}`)
}

async function brokers() {
  let set = 0, invalid = 0
  for await (const rows of pages<{ id: string; phone: string | null }>("brokers", "id, phone", (q) =>
    q.not("phone", "is", null).is("phone_e164", null),
  )) {
    const todo: Array<{ id: string; e164: string }> = []
    for (const r of rows) {
      const e164 = toE164(r.phone)
      if (e164) todo.push({ id: r.id, e164 })
      else invalid++
    }
    set += todo.length
    if (apply) await runLimited(todo, async (t) => check("brokers", await db.from("brokers").update({ phone_e164: t.e164 }).eq("id", t.id)))
  }
  return { set, invalid }
}

async function dnc() {
  const { data, error } = await db.from("do_not_call_numbers").select("id, phone")
  if (error) throw new Error(`do_not_call_numbers: ${error.message}`)
  const rows = (data ?? []) as Array<{ id: string; phone: string }>
  const existing = new Set(rows.map((r) => r.phone))
  let normalised = 0, merged = 0, unparsable = 0
  for (const r of rows) {
    const e164 = toE164(r.phone)
    if (!e164) { unparsable++; continue } // kept: a DNC entry we can't read is never deleted
    if (e164 === r.phone) continue
    if (existing.has(e164)) {
      merged++ // same number already listed in canonical form
      if (apply) await check("do_not_call_numbers", await db.from("do_not_call_numbers").delete().eq("id", r.id))
    } else {
      normalised++
      existing.add(e164)
      if (apply) await check("do_not_call_numbers", await db.from("do_not_call_numbers").update({ phone: e164 }).eq("id", r.id))
    }
  }
  return { normalised, merged, unparsable }
}

async function directNumbers() {
  let set = 0, invalid = 0
  for await (const rows of pages<{ id: string; direct_number: string }>("outreach_events", "id, direct_number", (q) =>
    q.not("direct_number", "is", null).is("direct_number_e164", null),
  )) {
    const todo: Array<{ id: string; e164: string }> = []
    for (const r of rows) {
      const e164 = toE164(r.direct_number)
      if (e164) todo.push({ id: r.id, e164 })
      else invalid++
    }
    set += todo.length
    if (apply) await runLimited(todo, async (t) => check("outreach_events", await db.from("outreach_events").update({ direct_number_e164: t.e164 }).eq("id", t.id)))
  }
  return { set, invalid }
}

// SMS threads are grouped by number, so old rows that stored "(214) 370-8737"
// would otherwise split from new "+12143708737" rows.
async function smsNumbers() {
  let fixed = 0, invalid = 0
  for await (const rows of pages<{ id: string; from_number: string | null; to_number: string | null }>(
    "outreach_events", "id, from_number, to_number", (q) => q.eq("channel", "sms"),
  )) {
    const todo: Array<{ id: string; patch: Record<string, string> }> = []
    for (const r of rows) {
      const patch: Record<string, string> = {}
      for (const col of ["from_number", "to_number"] as const) {
        const v = r[col]
        if (!v) continue
        const e164 = toE164(v)
        if (!e164) invalid++
        else if (e164 !== v) patch[col] = e164
      }
      if (Object.keys(patch).length) todo.push({ id: r.id, patch })
    }
    fixed += todo.length
    if (apply) await runLimited(todo, async (t) => check("outreach_events", await db.from("outreach_events").update(t.patch).eq("id", t.id)))
  }
  return { fixed, invalid }
}

async function main() {
  console.log(apply ? "APPLY mode: writing changes.\n" : "DRY RUN: nothing is written. Add --apply to write.\n")
  const b = await brokers()
  console.log(`brokers.phone_e164: ${apply ? "set" : "would set"} ${b.set}; ${b.invalid} phone(s) not valid -> left empty`)
  const d = await dnc()
  console.log(`do_not_call_numbers: ${apply ? "normalised" : "would normalise"} ${d.normalised}, ${apply ? "merged" : "would merge"} ${d.merged} duplicate(s), ${d.unparsable} unreadable kept as-is`)
  const e = await directNumbers()
  console.log(`outreach_events.direct_number_e164: ${apply ? "set" : "would set"} ${e.set}; ${e.invalid} not valid -> left empty`)
  const s = await smsNumbers()
  console.log(`outreach_events SMS from/to numbers: ${apply ? "normalised" : "would normalise"} ${s.fixed} row(s); ${s.invalid} number(s) not parsable (short codes etc.) kept as-is`)
  console.log(apply ? "\nDone. Re-run the STEP 3 check query in the migration file." : "\nDry run complete.")
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Unexpected error")
  process.exit(1)
})
