"use client"

import { useState, useTransition } from "react"
import { Download, Play } from "lucide-react"
import { toast } from "sonner"
import { getCallRecordingUrl } from "@/app/(dashboard)/calls/actions"

// The signed link is only fetched when someone presses play, and lasts an hour.
export function CallRecordingPlayer({ eventId, showDownload = false }: { eventId: string; showDownload?: boolean }) {
  const [url, setUrl] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function load(download: boolean) {
    startTransition(async () => {
      const res = await getCallRecordingUrl(eventId, download)
      if (!res.url) {
        toast.error(res.error ?? "Recording not available")
        return
      }
      if (download) window.location.href = res.url
      else setUrl(res.url)
    })
  }

  const linkClass = "inline-flex items-center gap-1 text-xs text-blue-600 hover:underline disabled:opacity-50 dark:text-blue-400"

  return (
    <div className="flex flex-wrap items-center gap-3">
      {url ? (
        // onError: the signed link expired while the page stayed open, so go back to the button.
        <audio controls autoPlay preload="none" src={url} onError={() => setUrl(null)} className="h-8 w-full max-w-sm" />
      ) : (
        <button type="button" onClick={() => load(false)} disabled={isPending} className={linkClass}>
          <Play className="size-3" />
          {isPending ? "Loading…" : "Play recording"}
        </button>
      )}
      {showDownload && (
        <button type="button" onClick={() => load(true)} disabled={isPending} className={linkClass}>
          <Download className="size-3" />
          Download
        </button>
      )}
    </div>
  )
}
