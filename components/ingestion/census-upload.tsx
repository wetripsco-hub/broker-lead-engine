"use client"

import { useRef, useState, useTransition } from "react"
import { Upload, FileCheck2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { uploadCensusFile, type CensusFileInfo } from "@/app/(dashboard)/ingestion/upload-actions"

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function CensusUpload({ initialInfo }: { initialInfo: CensusFileInfo | null }) {
  const [info, setInfo] = useState(initialInfo)
  const [fileName, setFileName] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)

    const formData = new FormData()
    formData.set("file", file)

    startTransition(async () => {
      const { error } = await uploadCensusFile(formData)
      if (error) {
        toast.error(`Upload failed: ${error}`)
        setFileName(null)
      } else {
        toast.success("Census file uploaded")
        setInfo({ uploadedAt: new Date().toISOString(), sizeBytes: file.size })
      }
      if (inputRef.current) inputRef.current.value = ""
    })
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-medium">FMCSA Census file</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            FMCSA blocks automated downloads — download the Census 1 file from{" "}
            <a
              href="https://www.fmcsa.dot.gov/registration/making-fmcsa-data-your-own"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              fmcsa.dot.gov
            </a>{" "}
            in your own browser, then upload it here (.zip or .txt).
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 shrink-0"
          disabled={isPending}
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="size-3.5" />
          {isPending ? "Uploading…" : "Upload file"}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept=".zip,.txt,.csv"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {info && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground pt-2 mt-1 border-t">
          <FileCheck2 className="size-3.5 text-green-600 dark:text-green-400 shrink-0" />
          <span>
            {fileName ? `${fileName} · ` : ""}Last uploaded {new Date(info.uploadedAt).toLocaleString()}
            {" · "}
            {formatSize(info.sizeBytes)}
          </span>
        </div>
      )}
    </div>
  )
}
