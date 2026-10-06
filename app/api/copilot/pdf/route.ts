import { NextResponse } from "next/server"
import { extractText, getDocumentProxy } from "unpdf"
import { createClient } from "@/lib/supabase/server"

const MAX_BYTES = 10 * 1024 * 1024

// Admin-only: PDF -> plain text for the knowledge base editor. Nothing is
// stored here; the admin reviews the text and saves it.
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user?.user_metadata?.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 })
  }

  const form = await request.formData()
  const file = form.get("file")
  if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "PDF too large (10 MB max)" }, { status: 413 })

  try {
    const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()))
    const { text } = await extractText(pdf, { mergePages: true })
    const out = (Array.isArray(text) ? text.join("\n\n") : text).trim()
    if (!out) return NextResponse.json({ error: "No text found (scanned PDF?)" }, { status: 422 })
    return NextResponse.json({ text: out })
  } catch {
    return NextResponse.json({ error: "Could not read this PDF" }, { status: 422 })
  }
}
