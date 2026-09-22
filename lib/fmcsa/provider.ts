import type { BrokerRecord, FetchOptions } from "./types"

/**
 * Abstract data source for freight broker records.
 *
 * Implement this interface to swap data sources without touching
 * the rest of the application (ingestion service, API route, cron job).
 *
 * Current implementations:
 *   - FmcsaCensusProvider    (bulk file — discovers new registrations; default)
 *   - MockBrokerDataProvider (local dev / testing)
 *
 * The QCMobile API (lib/fmcsa/api-provider.ts) is lookup-only — it has no
 * listing/search endpoint, so it cannot implement this interface. It is
 * instead called by IngestionService to enrich records this provider finds.
 */
export interface BrokerDataProvider {
  /**
   * Human-readable name shown in logs and the ingestion log UI.
   */
  readonly name: string

  /**
   * Return broker records from this source.
   * Providers MUST respect `options.since` when set — only records
   * registered on or after that date should be returned.
   */
  fetchBrokers(options?: FetchOptions): Promise<BrokerRecord[]>
}
