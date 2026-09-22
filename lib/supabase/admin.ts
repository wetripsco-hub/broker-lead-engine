import { createClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

/**
 * Service-role Supabase client — bypasses RLS.
 * Only use in server-side contexts (API routes, Edge Functions, cron jobs).
 * Never expose to the browser.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. " +
        "Add SUPABASE_SERVICE_ROLE_KEY to .env.local (get it from Supabase Dashboard → Settings → API)."
    )
  }

  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
