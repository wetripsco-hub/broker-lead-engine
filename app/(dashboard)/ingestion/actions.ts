"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { IngestionService } from "@/lib/ingestion/service"
import { FmcsaCensusProvider } from "@/lib/fmcsa/census-provider"
import { MockBrokerDataProvider } from "@/lib/fmcsa/mock-provider"

export async function triggerManualIngest(): Promise<{ message: string }> {
  // Only admins can trigger manual runs
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const role = user?.user_metadata?.role
  if (role !== "admin") {
    return { message: "Error: admin access required." }
  }

  const useMock = process.env.FMCSA_USE_MOCK === "true"
  const provider = useMock ? new MockBrokerDataProvider() : new FmcsaCensusProvider()
  const service = new IngestionService(provider)

  try {
    const summary = await service.run()
    return {
      message: `Run complete (${provider.name}) — ${summary.inserted} new brokers inserted, ${summary.updated} updated (${summary.fetched} fetched).`,
    }
  } catch (err) {
    return { message: `Error: ${err instanceof Error ? err.message : String(err)}` }
  }
}

export async function deleteIngestionLog(id: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user?.user_metadata?.role !== "admin") {
    return { error: "Admin access required" }
  }

  const { error } = await supabase.from("daily_ingestion_log").delete().eq("id", id)
  if (error) return { error: error.message }

  revalidatePath("/ingestion")
  return {}
}
