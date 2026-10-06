"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"

async function requireAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user?.user_metadata?.role !== "admin") return null
  const { data: agent } = await (supabase.from("agents") as any)
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle()
  return { supabase, agentId: (agent as { id: string } | null)?.id ?? null }
}

export async function saveKbItem(input: {
  id?: string
  title: string
  content: string
  kind: "manual" | "playbook"
}): Promise<{ error?: string; id?: string }> {
  const admin = await requireAdmin()
  if (!admin) return { error: "admin only" }
  const title = input.title.trim()
  if (!title) return { error: "Title is required" }
  if (input.content.length > 400_000) return { error: "Content too large" }

  const row = { title, content: input.content, kind: input.kind, updated_by: admin.agentId }
  const q = input.id
    ? (admin.supabase.from("knowledge_base") as any).update(row).eq("id", input.id).select("id").single()
    : (admin.supabase.from("knowledge_base") as any).insert(row).select("id").single()
  const { data, error } = (await q) as { data: { id: string } | null; error: { message: string } | null }
  if (error) return { error: error.message }
  revalidatePath("/settings/knowledge")
  return { id: data?.id }
}

export async function deleteKbItem(id: string): Promise<{ error?: string }> {
  const admin = await requireAdmin()
  if (!admin) return { error: "admin only" }
  const { error } = (await (admin.supabase.from("knowledge_base") as any).delete().eq("id", id)) as {
    error: { message: string } | null
  }
  if (error) return { error: error.message }
  revalidatePath("/settings/knowledge")
  return {}
}

export async function setAnnounceRecording(on: boolean): Promise<{ error?: string }> {
  const admin = await requireAdmin()
  if (!admin) return { error: "admin only" }
  const { error } = (await (admin.supabase.from("app_settings") as any).upsert({
    key: "announce_recording",
    value: on,
    updated_at: new Date().toISOString(),
  })) as { error: { message: string } | null }
  if (error) return { error: error.message }
  revalidatePath("/settings")
  return {}
}
