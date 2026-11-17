"use client"

import { useState } from "react"
import { Copy, Voicemail } from "lucide-react"
import { toast } from "sonner"
import { formatPhoneDisplay } from "@/lib/phone"
import { agentNames } from "@/lib/call-script/fill"
import { voicemailScript } from "@/lib/callbacks/rules"

// Our outbound caller ID is the Telnyx number, so it is also the number brokers call back on.
export const CALLER_ID_NUMBER = process.env.NEXT_PUBLIC_TELNYX_FROM_NUMBER ?? ""

async function copy(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(done)
  } catch {
    toast.error("Couldn't copy. Select the text and copy it by hand.")
  }
}

export function CallbackNumberCard({ brokerName, agentName }: { brokerName: string | null; agentName: string | null }) {
  const [scriptOpen, setScriptOpen] = useState(false)
  const number = formatPhoneDisplay(CALLER_ID_NUMBER)
  if (!number) return null
  const script = voicemailScript({ brokerName, agentFirstName: agentNames(agentName).firstName, callbackNumber: number })

  return (
    <div className="w-full space-y-2 rounded-lg border bg-muted/40 px-3 py-2 text-left">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Your callback number</p>
          <p className="font-mono text-sm font-semibold tabular-nums">{number}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => copy(number, "Callback number copied")}
            className="inline-flex h-7 items-center gap-1 rounded-md border bg-background px-2 text-xs transition-colors hover:bg-accent active:scale-[0.97]"
          >
            <Copy className="size-3" />
            Copy
          </button>
          <button
            type="button"
            onClick={() => setScriptOpen((o) => !o)}
            aria-expanded={scriptOpen}
            className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs transition-colors hover:bg-accent active:scale-[0.97] ${scriptOpen ? "bg-accent" : "bg-background"}`}
          >
            <Voicemail className="size-3" />
            Voicemail script
          </button>
        </div>
      </div>
      {scriptOpen && (
        <div className="space-y-1.5 border-t pt-2">
          <p className="text-sm leading-snug">&ldquo;{script}&rdquo;</p>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-amber-700 dark:text-amber-400">Say it slowly, and say the number twice, clearly.</p>
            <button
              type="button"
              onClick={() => copy(script, "Voicemail script copied")}
              className="inline-flex shrink-0 items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
            >
              <Copy className="size-3" />
              Copy
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
