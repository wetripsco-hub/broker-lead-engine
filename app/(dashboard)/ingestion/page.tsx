import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { IngestionLogClient } from "./ingestion-log-client"
import type { Database } from "@/types/database"

type LogRow = Database["public"]["Tables"]["daily_ingestion_log"]["Row"]
type BrokerRow = Pick<
  Database["public"]["Tables"]["brokers"]["Row"],
  "id" | "mc_number" | "company_name" | "city" | "state" | "email" | "phone" | "registration_date"
>

export default async function IngestionPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const isAdmin = user.user_metadata?.role === "admin"

  // Fetch log rows, most recent first
  const { data: logsRaw } = await supabase
    .from("daily_ingestion_log")
    .select("*")
    .order("run_date", { ascending: false })
    .limit(90)

  const logs = logsRaw as LogRow[] | null

  // For each log that has new brokers, fetch those brokers
  // We do a single query filtered by ingestion_run_id to avoid N+1
  const logIds = (logs ?? []).filter((l) => l.new_count > 0).map((l) => l.id)

  let brokersByRunId: Record<string, BrokerRow[]> = {}

  if (logIds.length > 0) {
    const { data: brokersRaw } = await supabase
      .from("brokers")
      .select("id, mc_number, company_name, city, state, email, phone, registration_date, ingestion_run_id")
      .in("ingestion_run_id", logIds)
      .order("company_name", { ascending: true })

    for (const b of brokersRaw ?? []) {
      const row = b as BrokerRow & { ingestion_run_id: string | null }
      if (!row.ingestion_run_id) continue
      if (!brokersByRunId[row.ingestion_run_id]) brokersByRunId[row.ingestion_run_id] = []
      brokersByRunId[row.ingestion_run_id].push(row)
    }
  }

  const enrichedLogs = (logs ?? []).map((log) => ({
    ...log,
    brokers: brokersByRunId[log.id] ?? [],
  }))

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <IngestionLogClient logs={enrichedLogs} isAdmin={isAdmin} />
    </div>
  )
}
