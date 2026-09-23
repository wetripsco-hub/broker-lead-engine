"use client"

import { useRef, useState } from "react"
import { FileUp, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

// Runs the exact same pipeline as ScraperRunner (SAFER + MOTUS enrichment +
// Supabase save) but sourced from a manually-uploaded REGISTER PDF instead
// of auto-discovering it from motus.dot.gov.
export function PdfUploadRunner({ onFinished }: { onFinished: () => void }) {
  const [running, setRunning] = useState(false)
  const [lines, setLines] = useState<string[]>([])
  const [date, setDate] = useState(todayIso())
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    setRunning(true)
    setLines([])

    try {
      const formData = new FormData()
      formData.set("file", file)
      formData.set("date", date)

      const res = await fetch("/api/scrape/upload", { method: "POST", body: formData })

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({ error: "Unknown error" }))
        toast.error(data.error ?? "Failed to process PDF")
        setRunning(false)
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        setLines((prev) => [...prev, ...chunk.split("\n").filter(Boolean)])
        requestAnimationFrame(() => {
          logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
        })
      }

      toast.success(`PDF processed — register date ${date}`)
      onFinished()
    } catch (err) {
      toast.error(`Upload error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setRunning(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-medium flex items-center gap-1.5">
            <FileUp className="size-3.5" />
            Upload broker register PDF
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Already have a REGISTER PDF from motus.dot.gov? Upload it here — runs the same
            parse → SAFER → MOTUS enrichment → Supabase save pipeline as "Run scraper now",
            without needing live discovery.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={running}
            max={todayIso()}
            className="h-9 rounded-md border bg-background px-2.5 text-sm"
          />
          <Button
            variant="outline"
            size="sm"
            className="gap-2 shrink-0"
            disabled={running}
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="size-3.5" />
            {running ? "Processing…" : "Upload PDF"}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleFile(file)
            }}
          />
        </div>
      </div>

      {lines.length > 0 && (
        <div
          ref={logRef}
          className="rounded-md bg-muted/50 border p-3 max-h-64 overflow-y-auto font-mono text-xs whitespace-pre-wrap"
        >
          {lines.join("\n")}
        </div>
      )}
    </div>
  )
}
