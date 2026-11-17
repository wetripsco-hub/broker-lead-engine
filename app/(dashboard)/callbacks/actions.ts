"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isAdminInDb } from "@/lib/voice-agents/admin-check"
import { toE164 } from "@/lib/phone"
import { DEFAULT_GREETING } from "@/lib/callbacks/rules"

async function signedInAdmin(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }
  if (!(await isAdminInDb(createAdminClient(), user.id))) return { error: "admin only" }
  return { userId: user.id }
}

export async function setCallbackHandled(id: string, handled: boolean): Promise<{ error?: string }> {
  const who = await signedInAdmin()
  if ("error" in who) return who
  const { error } = await (createAdminClient().from("callbacks") as any)
    .update(handled ? { handled_at: new Date().toISOString(), handled_by: who.userId } : { handled_at: null, handled_by: null })
    .eq("id", id)
  if (error) return { error: error.message }
  revalidatePath("/callbacks")
  revalidatePath("/leads")
  return {}
}

/**
 * Short-lived link to a voicemail. The row is read through the user's own session first, so RLS
 * decides: an admin gets any, an agent only voicemails on leads assigned to them.
 */
export async function getVoicemailUrl(id: string): Promise<{ url?: string; error?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }
  const { data } = await (supabase.from("callbacks") as any).select("recording_path").eq("id", id).maybeSingle()
  const path = (data as { recording_path: string | null } | null)?.recording_path
  if (!path) return { error: "Recording not available" }
  const { data: signed } = await createAdminClient().storage.from("call-recordings").createSignedUrl(path, 3600)
  return signed?.signedUrl ? { url: signed.signedUrl } : { error: "Recording not available" }
}

export interface InboundSettingsInput {
  forwardTo: string
  ringTimeoutSecs: number
  hoursEnabled: boolean
  timezone: string
  openDays: number[]
  openTime: string
  closeTime: string
  greeting: string
  notifyEmail: string
}

export async function saveInboundSettings(input: InboundSettingsInput): Promise<{ error?: string }> {
  const who = await signedInAdmin()
  if ("error" in who) return who

  let forwardTo: string | null = null
  if (input.forwardTo.trim()) {
    forwardTo = toE164(input.forwardTo)
    if (!forwardTo) return { error: "The forwarding number is not a valid phone number" }
  }
  const ring = Math.round(Number(input.ringTimeoutSecs))
  if (!Number.isFinite(ring) || ring < 5 || ring > 60) return { error: "Ring time must be between 5 and 60 seconds" }
  const time = /^([01]\d|2[0-3]):[0-5]\d$/
  if (!time.test(input.openTime) || !time.test(input.closeTime)) return { error: "Hours must look like 09:00" }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: input.timezone })
  } catch {
    return { error: "Unknown time zone" }
  }
  const days = [...new Set(input.openDays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
  const greeting = input.greeting.trim().slice(0, 1000) || DEFAULT_GREETING
  const emails = input.notifyEmail.split(/[,;\s]+/).filter(Boolean)
  if (emails.some((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))) return { error: "Check the notification email address" }

  const { error } = await (createAdminClient().from("inbound_call_settings") as any).upsert({
    id: true,
    forward_to: forwardTo,
    ring_timeout_secs: ring,
    hours_enabled: input.hoursEnabled,
    timezone: input.timezone,
    open_days: days,
    open_time: input.openTime,
    close_time: input.closeTime,
    greeting,
    notify_email: emails.length ? emails.join(", ") : null,
    updated_at: new Date().toISOString(),
  })
  if (error) return { error: error.message }
  revalidatePath("/callbacks")
  return {}
}
