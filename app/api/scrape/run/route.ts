import { NextRequest, NextResponse } from "next/server"
import { spawn } from "child_process"
import path from "path"
import { createClient } from "@/lib/supabase/server"
import { weekdaysInRange } from "@/lib/scrape-range"

// This route spawns a local Python process (src/scripts/broker_scraper.py).
// Vercel's serverless functions have no Python runtime, so this only works
// when Next.js and Python run on the SAME machine — i.e. `next dev` on your
// own computer, not the deployed app. Detect and refuse early rather than
// let it fail confusingly mid-stream. (The scraper no longer needs a
// browser — every step is a plain HTTP call — so porting it to TypeScript
// would let it run on Vercel Cron.)
const IS_VERCEL = Boolean(process.env.VERCEL)

export async function POST(req: NextRequest) {
  if (IS_VERCEL) {
    return NextResponse.json(
      {
        error:
          "The broker scraper needs a local Python + browser environment and can't run on Vercel. " +
          "Run it from your own machine: `python src/scripts/broker_scraper.py` (with `next dev` running locally).",
      },
      { status: 501 },
    )
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || user.app_metadata?.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })
  }

  // Optional: which day's FMCSA register to fetch (YYYY-MM-DD). Defaults to
  // "most recent available" in the Python script when omitted.
  // A range ({ from, to }) runs every business day in it, one after the other.
  const body = (await req.json().catch(() => ({}))) as { date?: string; from?: string; to?: string }
  let days: Array<string | undefined>
  if (typeof body.from === "string" && typeof body.to === "string") {
    const range = weekdaysInRange(body.from, body.to)
    if (!range.ok) return NextResponse.json({ error: range.error }, { status: 400 })
    days = range.dates
  } else {
    days = [typeof body.date === "string" && body.date ? body.date : undefined]
  }

  const scriptPath = path.join(process.cwd(), "src", "scripts", "broker_scraper.py")
  const pythonBin = process.env.PYTHON_BIN || (process.platform === "win32" ? "python" : "python3")

  const encoder = new TextEncoder()

  // One Python run for one day. Resolves with the exit code (null = could not start).
  function runDay(pdfDate: string | undefined, controller: ReadableStreamDefaultController<Uint8Array>): Promise<number | null> {
    return new Promise((resolve) => {
      const child = spawn(pythonBin, [scriptPath], {
        cwd: process.cwd(),
        env: { ...process.env, ...(pdfDate ? { PDF_DATE: pdfDate } : {}) },
      })
      child.stdout.on("data", (chunk: Buffer) => controller.enqueue(encoder.encode(chunk.toString())))
      child.stderr.on("data", (chunk: Buffer) => controller.enqueue(encoder.encode(`[stderr] ${chunk.toString()}`)))
      child.on("error", (err) => {
        controller.enqueue(
          encoder.encode(`[scraper] Failed to start "${pythonBin}" — is Python installed and on PATH? (${err.message})\n`),
        )
        resolve(null)
      })
      child.on("close", (code) => {
        controller.enqueue(encoder.encode(`[scraper] Process exited with code ${code}\n`))
        resolve(code)
      })
    })
  }

  const stream = new ReadableStream({
    async start(controller) {
      let failed = 0
      for (let i = 0; i < days.length; i++) {
        if (days.length > 1) controller.enqueue(encoder.encode(`\n===== Day ${i + 1} of ${days.length}: ${days[i]} =====\n`))
        const code = await runDay(days[i], controller)
        if (code === null) break // Python is missing: no point trying the other days
        if (code !== 0) failed++ // e.g. a holiday with no register: carry on with the next day
      }
      if (days.length > 1) {
        controller.enqueue(encoder.encode(`\n[scraper] Range finished: ${days.length - failed} of ${days.length} days ran OK${failed ? `, ${failed} had no data or failed (see above)` : ""}\n`))
      }
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  })
}
