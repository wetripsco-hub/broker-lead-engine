import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isAdminInDb } from "@/lib/voice-agents/admin-check"
import type { AgreementRow } from "./format"

// Admin-side reads of agent_agreements. The table has no browser policies, so
// every read goes through the service role AFTER the caller is proven an admin.

/** Signed-in admin (checked in the token AND in the database), or null. */
export async function requireAgreementAdmin(): Promise<{ id: string } | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || user.app_metadata?.role !== "admin") return null
  if (!(await isAdminInDb(createAdminClient(), user.id))) return null
  return { id: user.id }
}

export async function loadAgreements(): Promise<AgreementRow[]> {
  const admin = createAdminClient()
  const rows: AgreementRow[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await (admin.from("agent_agreements") as any).select("*").order("signed_at", { ascending: false }).range(from, from + 999)
    if (error) throw error
    rows.push(...((data ?? []) as AgreementRow[]))
    if (!data || data.length < 1000) break
  }
  return rows
}

export async function loadAgreement(id: string): Promise<AgreementRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const admin = createAdminClient()
  const { data } = await (admin.from("agent_agreements") as any).select("*").eq("id", id).maybeSingle()
  return (data as AgreementRow | null) ?? null
}

/** Signatures since this admin last opened the Agreements tab. 0 if anything fails (e.g. migration missing). */
export async function newAgreementsCount(adminUserId: string): Promise<number> {
  try {
    const admin = createAdminClient()
    const { data: seen } = await (admin.from("agreement_admin_seen") as any).select("last_seen_at").eq("admin_user_id", adminUserId).maybeSingle()
    let q = (admin.from("agent_agreements") as any).select("id", { count: "exact", head: true })
    if (seen?.last_seen_at) q = q.gt("signed_at", seen.last_seen_at)
    const { count } = await q
    return (count as number | null) ?? 0
  } catch {
    return 0
  }
}
