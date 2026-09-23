import { NextRequest, NextResponse } from "next/server"
import { spawn } from "child_process"
import path from "path"
import { createClient } from "@/lib/supabase/server"

// This route spawns a local Python process (src/scripts/broker_scraper.py)
// using Scrapling's StealthyFetcher, which needs a real Camoufox/Firefox
// browser binary. Vercel's serverless functions have no Python runtime and
// cannot install/run a browser binary, so this only works when Next.js and
// the Python environment are running on the SAME machine — i.e. `next dev`
// on your own computer, not the deployed Vercel app. Detect and refuse
// early rather than let it fail confusingly mid-stream.
const IS_VERCEL = Boolean(process.env.VERCEL)

export async function POST() {
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

  const scriptPath = path.join(process.cwd(), "src", "scripts", "broker_scraper.py")
  const pythonBin = process.env.PYTHON_BIN || (process.platform === "win32" ? "python" : "python3")

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      const child = spawn(pythonBin, [scriptPath], { cwd: process.cwd() })

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
