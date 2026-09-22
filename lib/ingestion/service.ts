import type { BrokerDataProvider } from "@/lib/fmcsa/provider"
import type { IngestionSummary } from "@/lib/fmcsa/types"
import { enrichBrokers } from "@/lib/fmcsa/api-provider"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * IngestionService
 *
 * Orchestrates a single ingestion run:
 *  1. Opens a `daily_ingestion_log` row (status = "running")
 *  2. Calls the provider to discover broker records (default: last 30 days)
 *  3. Diffs against existing MC numbers in `brokers`
 *  4. Enriches new/changed records with a live QCMobile lookup (best-effort)
 *  5. Bulk-inserts genuinely new records (with ingestion_run_id)
 *  6. The `on_broker_inserted` trigger auto-creates a lead at stage='new'
 *  7. Bulk-updates records that already exist (refreshed profile fields)
 *  8. Marks the log row as "success" or "error"
 */
export class IngestionService {
  constructor(private readonly provider: BrokerDataProvider) {}

  async run(since?: Date): Promise<IngestionSummary> {
    const supabase = createAdminClient()
    const runDate = new Date().toISOString().slice(0, 10)

    // Open log row
    const { data: logRow, error: logErr } = await (supabase
      .from("daily_ingestion_log") as any)
      .insert({
        run_date: runDate,
        status: "running",
        fetched_count: 0,
        new_count: 0,
        updated_count: 0,
      })
      .select("id")
      .single() as { data: { id: string } | null; error: { message: string } | null }

    if (logErr || !logRow) {
      throw new Error(`Failed to create ingestion log row: ${logErr?.message}`)
    }

    const logId = logRow.id

    try {
      // Fetch from provider — default lookback is the last 30 days
      const since_ = since ?? (() => {
        const d = new Date()
        d.setDate(d.getDate() - 30)
        return d
      })()

      const records = await this.provider.fetchBrokers({ since: since_ })

      if (records.length === 0) {
        await this.#closeLog(supabase, logId, "success", 0, 0, 0)
        return { fetched: 0, inserted: 0, updated: 0 }
      }

      // Fetch existing MC numbers in one query (chunked if large)
      const mcNumbers = records.map((r) => r.mcNumber)
      const existing = await this.#fetchExistingMcNumbers(supabase, mcNumbers)

      // Split into new vs already-known (existing get updated, not skipped)
      const toInsertRaw = records.filter((r) => !existing.has(r.mcNumber))
      const toUpdateRaw = records.filter((r) => existing.has(r.mcNumber))

      // Best-effort live refresh via QCMobile (skipped per-record on any
      // failure — census data is always the fallback, never blocks the run)
      const [toInsert, toUpdate] = await Promise.all([
        enrichBrokers(toInsertRaw),
        enrichBrokers(toUpdateRaw),
      ])

      // Bulk insert new brokers in batches of 500
      let inserted = 0
      const BATCH = 500
      for (let i = 0; i < toInsert.length; i += BATCH) {
        const batch = toInsert.slice(i, i + BATCH).map((r) => ({
          mc_number: r.mcNumber,
          dot_number: r.dotNumber ?? null,
          company_name: r.companyName,
          contact_name: r.contactName ?? null,
          email: r.email ?? null,
          phone: r.phone ?? null,
          address_line1: r.addressLine1 ?? null,
          city: r.city ?? null,
          state: r.state ?? null,
          zip: r.zip ?? null,
          authority_status: r.authorityStatus ?? null,
          registration_date: r.registrationDate?.toISOString().slice(0, 10) ?? null,
          ingestion_run_id: logId,
        }))

        const { error } = await (supabase.from("brokers") as any).insert(batch) as { error: { message: string } | null }
        if (error) throw new Error(`Broker insert failed: ${error.message}`)
        inserted += batch.length
      }

      // Refresh already-known brokers with the latest FMCSA data
      // (one update per row — mc_number is unique, no bulk upsert-by-column needed)
      let updated = 0
      for (const r of toUpdate) {
        const { error } = await (supabase.from("brokers") as any)
          .update({
            dot_number: r.dotNumber ?? null,
            company_name: r.companyName,
            contact_name: r.contactName ?? null,
            email: r.email ?? null,
            phone: r.phone ?? null,
            address_line1: r.addressLine1 ?? null,
            city: r.city ?? null,
            state: r.state ?? null,
            zip: r.zip ?? null,
            authority_status: r.authorityStatus ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq("mc_number", r.mcNumber) as { error: { message: string } | null }
        if (error) throw new Error(`Broker update failed (MC-${r.mcNumber}): ${error.message}`)
        updated++
      }

      await this.#closeLog(supabase, logId, "success", records.length, inserted, updated)
      return { fetched: records.length, inserted, updated }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await this.#closeLog(supabase, logId, "error", 0, 0, 0, msg)
      throw err
    }
  }

  async #fetchExistingMcNumbers(
    supabase: ReturnType<typeof createAdminClient>,
    mcNumbers: string[]
  ): Promise<Set<string>> {
    const existing = new Set<string>()
    const CHUNK = 1000
    for (let i = 0; i < mcNumbers.length; i += CHUNK) {
      const chunk = mcNumbers.slice(i, i + CHUNK)
      const { data } = await supabase
        .from("brokers")
        .select("mc_number")
        .in("mc_number", chunk)
      data?.forEach((r) => existing.add((r as { mc_number: string }).mc_number))
    }
    return existing
  }

  async #closeLog(
    supabase: ReturnType<typeof createAdminClient>,
    logId: string,
    status: "success" | "error",
    fetched: number,
    newCount: number,
    updatedCount: number,
    errorMessage?: string
  ) {
    await (supabase.from("daily_ingestion_log") as any)
      .update({
        status,
        fetched_count: fetched,
        new_count: newCount,
        updated_count: updatedCount,
        error_message: errorMessage ?? null,
        finished_at: new Date().toISOString(),
      })
      .eq("id", logId)
  }
}
