"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { CENSUS_BUCKET, CENSUS_OBJECT_PATH } from "@/lib/fmcsa/census-provider"

export interface CensusFileInfo {
  uploadedAt: string
  sizeBytes: number
}

export async function uploadCensusFile(
  formData: FormData,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user || user.user_metadata?.role !== "admin") {
    return { error: "Admin access required" }
  }

  const file = formData.get("file")
  if (!(file instanceof File) || file.size === 0) {
    return { error: "No file selected" }
  }
  if (file.size > 100 * 1024 * 1024) {
    return { error: "File too large (max 100 MB)" }
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const admin = createAdminClient()

  const { error } = await admin.storage
    .from(CENSUS_BUCKET)
    .upload(CENSUS_OBJECT_PATH, buffer, {
      upsert: true,
      contentType: file.type || "application/octet-stream",
    })

  if (error) return { error: error.message }

  revalidatePath("/ingestion")
  return {}
}

export async function getCensusFileInfo(): Promise<CensusFileInfo | null> {
  const admin = createAdminClient()
  const { data, error } = await admin.storage.from(CENSUS_BUCKET).list("", {
    search: CENSUS_OBJECT_PATH,
  })
  if (error || !data || data.length === 0) return null

  const obj = data[0]
  const sizeBytes = (obj.metadata as { size?: number } | null)?.size ?? 0
  return {
    uploadedAt: obj.updated_at ?? obj.created_at ?? new Date().toISOString(),
    sizeBytes,
  }
}
