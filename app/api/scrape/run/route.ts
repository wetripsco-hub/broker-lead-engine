import { NextRequest, NextResponse } from "next/server"
import { spawn } from "child_process"
import path from "path"
import { createClient } from "@/lib/supabase/server"

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
  if (!user || user.user_metadata?.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })
  }

  // Optional: which day's FMCSA register to fetch (YYYY-MM-DD). Defaults to
  // "most recent available" in the Python script when omitted.
  const body = await req.json().catch(() => ({}) as { date?: string })
  const pdfDate = typeof body.date === "string" && body.date ? body.date : undefined

  const scriptPath = path.join(process.cwd(), "src", "scripts", "broker_scraper.py")
  const pythonBin = process.env.PYTHON_BIN || (process.platform === "win32" ? "python" : "python3")

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      const child = spawn(pythonBin, [scriptPath], {
        cwd: process.cwd(),
        env: { ...process.env, ...(pdfDate ? { PDF_DATE: pdfDate } : {}) },
      })

      child.stdout.on("data", (chunk: Buffer) => {
        controller.enqueue(encoder.encode(chunk.toString()))
      })
      child.stderr.on("data", (chunk: Buffer) => {
        controller.enqueue(encoder.encode(`[stderr] ${chunk.toString()}`))
      })
      child.on("error", (err) => {
        controller.enqueue(
          encoder.encode(
            `[scraper] Failed to start "${pythonBin}" — is Python installed and on PATH? (${err.message})\n`,
          ),
        )
        controller.close()
      })
      child.on("close", (code) => {
        controller.enqueue(encoder.encode(`[scraper] Process exited with code ${code}\n`))
        controller.close()
      })
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  })
}
