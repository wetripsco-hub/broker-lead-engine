"use client"

import { useState } from "react"
import { Download, ExternalLink, FileWarning, Film, Link2, Paperclip } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import type { RecruitMedia } from "./types"

const PROVIDER_LABEL: Record<string, string> = {
  gdrive: "Google Drive",
  dropbox: "Dropbox",
  onedrive: "OneDrive",
  wetransfer: "WeTransfer",
  icloud: "iCloud",
  youtube: "YouTube",
  loom: "Loom",
  vimeo: "Vimeo",
  direct: "Video file",
  unknown: "Link",
}

function hostOf(url: string | null): string {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, "") : ""
  } catch {
    return ""
  }
}

function sizeLabel(n: number | null): string {
  if (!n) return ""
  if (n > 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(n / 1024))} KB`
}

export function MediaCard({ m }: { m: RecruitMedia }) {
  const [failed, setFailed] = useState(false)
  const src = `/api/recruiter/attachment/${m.id}`

  if (m.status === "skipped") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground opacity-70">
        <FileWarning className="size-4" />
        <span className="truncate">{m.file_name}</span>
        <span className="ml-auto shrink-0">Unsafe file type, not opened</span>
      </div>
    )
  }

  if (m.source_type === "attachment") {
    const mime = (m.mime_type ?? "").toLowerCase()
    const isVideo = mime.startsWith("video/")
    const isImage = mime.startsWith("image/") && !/heic|heif/.test(mime)
    return (
      <div className="rounded-lg border bg-background overflow-hidden">
        {isVideo && !failed && (
          <video controls preload="metadata" className="w-full max-h-96 bg-black" src={src} onError={() => setFailed(true)} />
        )}
        {isImage && !failed && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={m.file_name ?? "attachment"} className="max-h-96 w-auto mx-auto" onError={() => setFailed(true)} />
        )}
        {(failed || (!isVideo && !isImage)) && (
          <p className="px-3 pt-2 text-xs text-muted-foreground">
            {failed ? "Can't preview, click Download" : mime === "application/pdf" ? "PDF file" : "Preview not available, click Download"}
          </p>
        )}
        <div className="flex items-center gap-2 px-3 py-2 text-xs">
          <Paperclip className="size-3.5 text-muted-foreground" />
          <span className="truncate">{m.file_name}</span>
          <span className="text-muted-foreground shrink-0">{sizeLabel(m.size_bytes)}</span>
          <div className="ml-auto flex gap-1.5 shrink-0">
            {mime === "application/pdf" && (
              <a className={buttonVariants({ size: "xs", variant: "outline" })} href={src} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-3" /> Open
              </a>
            )}
            <a className={buttonVariants({ size: "xs", variant: "outline" })} href={`${src}?download=1`}>
              <Download className="size-3" /> Download
            </a>
          </div>
        </div>
      </div>
    )
  }

  if (m.status === "embedded" && m.embed_url) {
    return (
      <div className="rounded-lg border bg-background overflow-hidden">
        <div className="aspect-video bg-black">
          <iframe
            src={m.embed_url}
            className="size-full"
            allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            title={`${PROVIDER_LABEL[m.provider] ?? "Video"} player`}
          />
        </div>
        <div className="flex items-center gap-2 px-3 py-2 text-xs">
          <Film className="size-3.5 text-muted-foreground" />
          <span>{PROVIDER_LABEL[m.provider] ?? m.provider}</span>
          <a href={m.original_url ?? m.embed_url} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-primary hover:underline">
            Open on site <ExternalLink className="size-3" />
          </a>
        </div>
      </div>
    )
  }

  const known = m.provider !== "unknown"
  return (
    <div className="flex items-center gap-2.5 rounded-lg border bg-background px-3 py-2 text-xs">
      {known ? <Film className="size-4 text-muted-foreground" /> : <Link2 className="size-4 text-muted-foreground" />}
      <div className="min-w-0">
        <p className="font-medium">{PROVIDER_LABEL[m.provider] ?? m.provider}</p>
        <p className="text-muted-foreground truncate">{hostOf(m.original_url)}</p>
      </div>
      {m.original_url && (
        <a
          className={buttonVariants({ size: "xs", variant: known ? "default" : "outline", className: "ml-auto shrink-0" })}
          href={m.original_url}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink className="size-3" /> {known ? "Open video" : "Open link"}
        </a>
      )}
    </div>
  )
}
