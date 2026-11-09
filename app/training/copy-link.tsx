"use client"

import { useRef, useState } from "react"
import { Check, Copy } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"

export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  const textRef = useRef<HTMLSpanElement>(null)

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // No clipboard access (old browser or not allowed): select the text so the agent can copy it.
      const el = textRef.current
      const sel = window.getSelection()
      if (el && sel) {
        const range = document.createRange()
        range.selectNodeContents(el)
        sel.removeAllRanges()
        sel.addRange(range)
      }
    }
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <span
        ref={textRef}
        className="min-w-0 flex-1 break-all rounded-lg border bg-muted/40 px-3 py-2 font-mono text-sm select-all"
      >
        {url}
      </span>
      <button type="button" onClick={copy} className={buttonVariants({ className: "shrink-0" })}>
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  )
}
