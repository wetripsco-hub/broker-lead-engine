"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"

export async function createTemplate(formData: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  const name    = (formData.get("name") as string)?.trim()
  const subject = (formData.get("subject") as string)?.trim()
  const body    = (formData.get("body") as string)?.trim()

  if (!name || !subject || !body) return { error: "All fields required" }

  const { error } = await (supabase.from("email_templates") as any)
    .insert({ name, subject, body, created_by: user.id }) as { error: { message: string } | null }

  if (error) return { error: error.message }
  revalidatePath("/templates")
  redirect("/templates")
}

export async function updateTemplate(id: string, formData: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  const name    = (formData.get("name") as string)?.trim()
  const subject = (formData.get("subject") as string)?.trim()
  const body    = (formData.get("body") as string)?.trim()

  if (!name || !subject || !body) return { error: "All fields required" }

  const { error } = await (supabase.from("email_templates") as any)
    .update({ name, subject, body })
    .eq("id", id) as { error: { message: string } | null }

  if (error) return { error: error.message }
  revalidatePath("/templates")
  redirect("/templates")
}

export async function deleteTemplate(id: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user?.user_metadata?.role !== "admin") return { error: "admin only" }

  const { error } = await (supabase.from("email_templates") as any)
    .delete()
    .eq("id", id) as { error: { message: string } | null }

  if (error) return { error: error.message }
  revalidatePath("/templates")
  return { error: null }
}
