"use client"

import { useRef, useState } from "react"
import { Bot, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

// FMCSA only publishes a register on business days, so defaulting the
// picker to a Saturday or Sunday would guarantee a failed run.
function lastWeekdayIso() {
  const d = new Date()
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

export function ScraperRunner({ onFinished }: { onFinished: () => void }) {
  const [running, setRunning] = useState(false)
  const [lines, setLines] = useState<string[]>([])
  const [date, setDate] = useState(lastWeekdayIso())
  const logRef = useRef<HTMLDivElement>(null)

  async function handleRun() {
    setRunning(true)
    setLines([])

    try {
      const res = await fetch("/api/scrape/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date }),
      })

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({ error: "Unknown error" }))
        toast.error(data.error ?? "Failed to start scraper")
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

      toast.success(`Scraper run finished — register date ${date}`)
      onFinished()
    } catch (err) {
      toast.error(`Scraper error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-medium flex items-center gap-1.5">
            <Bot className="size-3.5" />
            Broker scraper (Scrapling)
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Runs locally only — needs `next dev` + Python on this machine. Won't work on the deployed
            Vercel app.
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
            onClick={handleRun}
          >
            <Play className="size-3.5" />
            {running ? "Running…" : "Run scraper now"}
          </Button>
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
