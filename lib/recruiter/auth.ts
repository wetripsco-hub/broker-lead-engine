import { createClient } from "@/lib/supabase/server"

/** Signed-in admin, or null. The role is read from app_metadata (service-role-only). */
export async function recruiterAdmin(): Promise<{ id: string } | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || user.app_metadata?.role !== "admin") return null
  return { id: user.id }
}
