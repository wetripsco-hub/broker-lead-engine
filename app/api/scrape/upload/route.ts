import { NextRequest, NextResponse } from "next/server"
import { spawn } from "child_process"
import { randomUUID } from "crypto"
import { mkdir, writeFile, unlink } from "fs/promises"
import path from "path"
import { createClient } from "@/lib/supabase/server"

// Same pipeline as /api/scrape/run (SAFER + MOTUS enrichment + Supabase
// save), but sourced from a manually-uploaded REGISTER PDF instead of
// auto-discovering it from motus.dot.gov — for when the automated PDF
// discovery is blocked/down, or you already have the file. Same Vercel
// restriction applies: local Python + browser environment only.
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

  const formData = await req.formData()
  const file = formData.get("file")
  const pdfDate = formData.get("date")

  if (!(file instanceof File) || file.type !== "application/pdf") {
    return NextResponse.json({ error: "Upload a .pdf file" }, { status: 400 })
  }

  const uploadsDir = path.join(process.cwd(), "src", "scripts", "uploads")
  await mkdir(uploadsDir, { recursive: true })
  const pdfPath = path.join(uploadsDir, `${randomUUID()}.pdf`)
  await writeFile(pdfPath, Buffer.from(await file.arrayBuffer()))

  const scriptPath = path.join(process.cwd(), "src", "scripts", "broker_scraper.py")
  const pythonBin = process.env.PYTHON_BIN || (process.platform === "win32" ? "python" : "python3")

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      const child = spawn(pythonBin, [scriptPath], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PDF_FILE_PATH: pdfPath,
          ...(typeof pdfDate === "string" && pdfDate ? { PDF_DATE: pdfDate } : {}),
        },
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
        unlink(pdfPath).catch(() => {})
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
