/**
 * Supabase Edge Function: ingest-brokers
 *
 * Alternative to the Vercel Cron approach. Schedule with pg_cron:
 *
 *   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
 *   select vault.create_secret('<anon-key>', 'anon_key');
 *
 *   select cron.schedule(
 *     'ingest-brokers-daily',
 *     '0 6 * * *',
 *     $$
 *       select net.http_post(
 *         url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
 *                || '/functions/v1/ingest-brokers',
 *         headers := jsonb_build_object(
 *           'Content-type', 'application/json',
 *           'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key')
 *         ),
 *         body := '{}'::jsonb
 *       ) as request_id;
 *     $$
 *   );
 *
 * Deploy: supabase functions deploy ingest-brokers
 *
 * Env vars needed in Supabase Dashboard → Edge Functions → Secrets:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FMCSA_CENSUS1_URL
 */

import { createClient } from "jsr:@supabase/supabase-js@2"
import { parse } from "npm:csv-parse/sync"

const CENSUS_URL =
  Deno.env.get("FMCSA_CENSUS1_URL") ??
  "https://www.fmcsa.dot.gov/sites/fmcsa.dot.gov/files/docs/licensing-and-insurance/data-and-statistics/census-downloads/current/FMCSA_CENSUS1.zip"

const DELIMITER = Deno.env.get("FMCSA_DELIMITER") ?? "|"
const ENTITY_COL = Deno.env.get("FMCSA_ENTITY_TYPE_COL") ?? "CARRIER_OPERATION"
const ENTITY_VAL = Deno.env.get("FMCSA_ENTITY_TYPE_VAL") ?? "BROKER"
const DATE_COL = Deno.env.get("FMCSA_DATE_COL") ?? "ADD_DATE"

Deno.serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  )

  const runDate = new Date().toISOString().slice(0, 10)

  const { data: logRow, error: logErr } = await supabase
    .from("daily_ingestion_log")
    .insert({ run_date: runDate, status: "running", fetched_count: 0, new_count: 0, updated_count: 0 })
    .select("id")
    .single()

  if (logErr || !logRow) {
    return Response.json({ error: logErr?.message }, { status: 500 })
  }

  const logId = logRow.id

  try {
    const since = new Date()
    since.setDate(since.getDate() - 1)

    // NOTE: Edge Function memory limit is 512MB. For large census files,
    // prefer the Next.js /api/ingest route (Vercel Pro: 15 min, 3GB).
    const response = await fetch(CENSUS_URL, {
      headers: { "User-Agent": "BrokerLeadEngine/1.0" },
    })
    if (!response.ok) throw new Error(`Fetch failed: ${response.status}`)

    // If ZIP, the Deno runtime doesn't have unzipper — expect plain text URL
    const text = await response.text()
    const rows = parse(text, {
      delimiter: DELIMITER,
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as Record<string, string>[]

    const brokers = rows
      .filter((r) => {
        const mc = r["MC_MX_FF_NUMBER"] ?? r["MC_NUMBER"] ?? ""
        const entity = (r[ENTITY_COL] ?? "").toUpperCase()
        const dateStr = r[DATE_COL] ?? ""
        const addDate = dateStr.length === 8
          ? new Date(`${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`)
          : new Date(dateStr)
        return mc.toUpperCase().startsWith("MC") &&
          entity.includes(ENTITY_VAL.toUpperCase()) &&
          addDate >= since
      })
      .map((r) => ({
        mc_number: (r["MC_MX_FF_NUMBER"] ?? r["MC_NUMBER"] ?? "").replace(/^MC-/i, "").trim(),
        dot_number: r["DOT_NUMBER"] || null,
        company_name: r["LEGAL_NAME"] ?? r["DBA_NAME"] ?? "",
        email: r["EMAIL_ADDRESS"] || null,
        phone: r["TELEPHONE"] || null,
        address_line1: r["PHY_STREET"] || null,
        city: r["PHY_CITY"] || null,
        state: r["PHY_STATE"] || null,
        zip: r["PHY_ZIP"] || null,
        authority_status: r["RECORD_STATUS_DESC"] || null,
        registration_date: r[DATE_COL] ? r[DATE_COL].slice(0, 10) : null,
        ingestion_run_id: logId,
      }))
      .filter((b) => b.company_name)

    // Diff
    const { data: existing } = await supabase
      .from("brokers")
      .select("mc_number")
      .in("mc_number", brokers.map((b) => b.mc_number))

    const existingSet = new Set((existing ?? []).map((r: any) => r.mc_number))
    const toInsert = brokers.filter((b) => !existingSet.has(b.mc_number))

    if (toInsert.length > 0) {
      const { error } = await supabase.from("brokers").insert(toInsert)
      if (error) throw new Error(error.message)
    }

    await supabase.from("daily_ingestion_log").update({
      status: "success",
      fetched_count: brokers.length,
      new_count: toInsert.length,
      updated_count: 0,
      finished_at: new Date().toISOString(),
    }).eq("id", logId)

    return Response.json({ ok: true, fetched: brokers.length, inserted: toInsert.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await supabase.from("daily_ingestion_log").update({
      status: "error",
      error_message: message,
      finished_at: new Date().toISOString(),
    }).eq("id", logId)
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
})
