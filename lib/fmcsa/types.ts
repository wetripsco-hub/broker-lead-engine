/**
 * Normalised broker record returned by any BrokerDataProvider.
 * All fields map 1-to-1 to the `brokers` table columns.
 */
export interface BrokerRecord {
  mcNumber: string         // unique; strips "MC-" prefix when stored
  dotNumber?: string
  companyName: string
  contactName?: string
  email?: string
  phone?: string
  addressLine1?: string
  city?: string
  state?: string
  zip?: string
  authorityStatus?: string
  registrationDate?: Date  // ADD_DATE from census / equivalent
}

export interface FetchOptions {
  /** Fetch only brokers registered on or after this date. */
  since?: Date
  /** Max records to return (provider-specific, best-effort). */
  limit?: number
}

export interface IngestionSummary {
  fetched: number
  inserted: number
  skipped: number   // already existed by MC number
}
