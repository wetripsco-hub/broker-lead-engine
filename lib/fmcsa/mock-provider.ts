/**
 * MockBrokerDataProvider — for local dev and testing.
 * Returns a small set of fake broker records so the ingestion
 * pipeline can be exercised without hitting the real FMCSA file.
 *
 * Usage: set FMCSA_USE_MOCK=true in .env.local
 */

import type { BrokerDataProvider } from "./provider"
import type { BrokerRecord, FetchOptions } from "./types"

const MOCK_BROKERS: BrokerRecord[] = [
  {
    mcNumber: "900001",
    dotNumber: "4100001",
    companyName: "Acme Freight Brokers LLC",
    email: "ops@acmefreight.example",
    phone: "555-100-0001",
    addressLine1: "100 Main St",
    city: "Chicago",
    state: "IL",
    zip: "60601",
    authorityStatus: "ACTIVE",
    registrationDate: new Date(),
  },
  {
    mcNumber: "900002",
    dotNumber: "4100002",
    companyName: "Swift Logistics Partners",
    email: "info@swiftlogistics.example",
    phone: "555-100-0002",
    addressLine1: "200 Oak Ave",
    city: "Dallas",
    state: "TX",
    zip: "75201",
    authorityStatus: "ACTIVE",
    registrationDate: new Date(),
  },
  {
    mcNumber: "900003",
    companyName: "Blue Ridge Brokerage Inc",
    city: "Atlanta",
    state: "GA",
    authorityStatus: "ACTIVE",
    registrationDate: new Date(),
  },
]

export class MockBrokerDataProvider implements BrokerDataProvider {
  readonly name = "Mock (local dev)"

  async fetchBrokers(options?: FetchOptions): Promise<BrokerRecord[]> {
    const since = options?.since
    let results = MOCK_BROKERS
    if (since) {
      results = results.filter(
        (b) => !b.registrationDate || b.registrationDate >= since
      )
    }
    return results.slice(0, options?.limit ?? results.length)
  }
}
