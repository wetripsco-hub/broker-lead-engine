import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { TRACKING_PIXEL_GIF } from "@/lib/email/tracking"

// Loaded by the recipient's email client as a plain <img> request — no
// Supabase session, so this always uses the admin client. It must never
// error or redirect: any failure still has to return a valid pixel, or
// the image breaks in the recipient's inbox.
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id")

  if (id) {
    try {
      const supabase = createAdminClient()
      const { data } = await (supabase.from("outreach_events") as any)
        .select("open_count, status")
        .eq("id", id)
        .maybeSingle()

      if (data) {
        const current = data as { open_count: number; status: string }
        await (supabase.from("outreach_events") as any)
          .update({
            opened_at: new Date().toISOString(),
            open_count: (current.open_count ?? 0) + 1,
            status: current.status === "clicked" ? "clicked" : "opened",
          })
          .eq("id", id)
      }
    } catch {
      // Swallow — the pixel must still render even if logging fails.
    }
  }

  return new NextResponse(TRACKING_PIXEL_GIF, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(TRACKING_PIXEL_GIF.length),
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Pragma: "no-cache",
    },
  })
}
