"use server"

import { createClient } from "@/lib/supabase/server"

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

  const secret = process.env.CRON_SECRET
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (secret) headers["Authorization"] = `Bearer ${secret}`

  // Call the local API route (works both in dev and on Vercel)
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001"

  try {
    const res = await fetch(`${baseUrl}/api/ingest`, {
      method: "POST",
      headers,
      // Use mock in dev unless overridden
      body: JSON.stringify({ mock: process.env.FMCSA_USE_MOCK === "true" }),
    })

    const data = await res.json()
    if (!res.ok) return { message: `Error: ${data.error ?? "Unknown error"}` }
    return {
      message: `Run complete — ${data.inserted ?? 0} new brokers inserted (${data.fetched ?? 0} fetched).`,
    }
  } catch (err) {
    return { message: `Error: ${err instanceof Error ? err.message : String(err)}` }
  }
}
