import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"

// Loaded by clicking a link in a sent email — no Supabase session, so this
// always uses the admin client.
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id")
  const rawUrl = req.nextUrl.searchParams.get("url")
  const fallback = process.env.NEXT_PUBLIC_SITE_URL ?? "/"

  if (!rawUrl) return NextResponse.redirect(fallback)

  // Only ever redirect to http(s) — refuse anything else (javascript:,
  // data:, etc.) so this can't be turned into an open redirect / XSS vector.
  let target: URL
  try {
    target = new URL(rawUrl)
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      return NextResponse.redirect(fallback)
    }
  } catch {
    return NextResponse.redirect(fallback)
  }

  if (id) {
    try {
      const supabase = createAdminClient()
      const { data } = await (supabase.from("outreach_events") as any)
        .select("click_count")
        .eq("id", id)
        .maybeSingle()

      if (data) {
        const current = data as { click_count: number }
        await (supabase.from("outreach_events") as any)
          .update({
            clicked_at: new Date().toISOString(),
            click_count: (current.click_count ?? 0) + 1,
            status: "clicked",
          })
          .eq("id", id)
      }
    } catch {
      // Swallow — the redirect must still happen even if logging fails.
    }
  }

  return NextResponse.redirect(target.toString())
}
