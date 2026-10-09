import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isAdminInDb } from "@/lib/voice-agents/admin-check"
import { fetchExportRows } from "@/lib/leads/export"
import { handleExport } from "@/lib/leads/export-handler"

// Building a spreadsheet of hundreds of leads (plus their events) can take a while.
export const maxDuration = 60
export const runtime = "nodejs"

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  // Everything is read with the signed-in user's own session (row-level security
  // applies). The service role is used for exactly one thing: looking up the
  // user's role in the database.
  const supabase = await createClient()

  const result = await handleExport(body, {
    async getUser() {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      return user ? { id: user.id, email: user.email ?? null } : null
    },
    isAdmin: (userId) => isAdminInDb(createAdminClient(), userId),
    loadRows: (ids) => fetchExportRows(supabase as any, ids),
    async recordAudit(entry) {
      const { error } = await (supabase.from("lead_exports") as any).insert({
        user_id: entry.userId,
        user_email: entry.userEmail,
        export_option: entry.mode,
        row_count: entry.rowCount,
        file_name: entry.fileName,
        filters: entry.filters,
      })
      return !error
    },
    now: () => new Date(),
  })

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  return new Response(new Uint8Array(result.buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${result.fileName}"`,
      "X-Export-Rows": String(result.rowCount),
      "Cache-Control": "no-store",
    },
  })
}
