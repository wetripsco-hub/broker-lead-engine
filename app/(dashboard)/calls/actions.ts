"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isAdminInDb } from "@/lib/voice-agents/admin-check"
import { resolveRecordingUrl } from "@/lib/calls/recording-access"

const SIGNED_URL_SECONDS = 3600

export async function getCallRecordingUrl(
  eventId: string,
  download = false,
): Promise<{ url?: string; error?: string }> {
  const supabase = await createClient()
  const admin = createAdminClient()

  return resolveRecordingUrl(eventId, download, {
    async userId() {
      const { data: { user } } = await supabase.auth.getUser()
      return user?.id ?? null
    },
    async readEvent(id) {
      const { data } = await (supabase.from("outreach_events") as any)
        .select("agent_id, recording_path")
        .eq("id", id)
        .maybeSingle()
      return data ?? null
    },
    isAdmin: (userId) => isAdminInDb(admin, userId),
    async ownAgentId(userId) {
      const { data } = await (supabase.from("agents") as any).select("id").eq("user_id", userId).maybeSingle()
      return (data as { id: string } | null)?.id ?? null
    },
    async signUrl(path, wantsDownload) {
      const { data } = await admin.storage
        .from("call-recordings")
        .createSignedUrl(path, SIGNED_URL_SECONDS, wantsDownload ? { download: `call-${eventId}.mp3` } : undefined)
      return data?.signedUrl ?? null
    },
  })
}
