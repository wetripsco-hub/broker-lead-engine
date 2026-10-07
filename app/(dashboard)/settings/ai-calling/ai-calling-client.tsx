"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { saveAiCallingSettings } from "./actions"

interface Props {
  settings: { enabled: boolean; testMode: boolean; testNumbers: string[]; dailyCap: number }
  env: { provider: string; agentId: string | null; fromNumber: string | null; keySet: boolean; transferSet: boolean }
  prompt: string
}

export function AiCallingClient({ settings, env, prompt }: Props) {
  const [enabled, setEnabled] = useState(settings.enabled)
  const [testMode, setTestMode] = useState(settings.testMode)
  const [numbers, setNumbers] = useState(settings.testNumbers.join("\n"))
  const [cap, setCap] = useState(String(settings.dailyCap))
  const [pending, startTransition] = useTransition()

  const dirty =
    enabled !== settings.enabled ||
    testMode !== settings.testMode ||
    numbers.split(/[\n,;]+/).filter(Boolean).join(",") !== settings.testNumbers.join(",") ||
    cap !== String(settings.dailyCap)

  function save() {
    startTransition(async () => {
      const res = await saveAiCallingSettings({ enabled, testMode, testNumbers: numbers, dailyCap: Number(cap) })
      if (res.error) toast.error(res.error)
      else {
        if (res.testNumbers) setNumbers(res.testNumbers.join("\n"))
        toast.success("Saved")
      }
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/settings" className="text-xs text-muted-foreground hover:text-foreground">
          ← Settings
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">AI calling</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Outbound calls placed by the AI voice agent. Every call is still checked for consent, do-not-call and
          calling hours on the server.
        </p>
      </div>

      <section className="space-y-4 rounded-lg border bg-card p-5">
        <Toggle
          label="AI calling enabled"
          hint="Master switch. While off, no AI call can be started from anywhere."
          checked={enabled}
          onChange={setEnabled}
        />
        <Toggle
          label="Test mode"
          hint="Only the numbers listed below can be called. Leave on until you've verified a call end to end."
          checked={testMode}
          onChange={setTestMode}
        />
        <div className="space-y-1.5">
          <label htmlFor="test-numbers" className="text-xs text-muted-foreground">
            Test numbers (one per line)
          </label>
          <textarea
            id="test-numbers"
            value={numbers}
            onChange={(e) => setNumbers(e.target.value)}
            rows={3}
            placeholder="+1 (321) 555-0123"
            className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="daily-cap" className="text-xs text-muted-foreground">
            Daily cap (AI calls in any rolling 24 hours)
          </label>
          <input
            id="daily-cap"
            type="number"
            min={0}
            max={1000}
            value={cap}
            onChange={(e) => setCap(e.target.value)}
            className="h-8 w-28 rounded-md border border-input bg-transparent px-3 text-sm tabular-nums outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="flex justify-end">
          <Button size="sm" onClick={save} disabled={!dirty || pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </section>

      <section className="space-y-3 rounded-lg border bg-card p-5">
        <h2 className="text-sm font-semibold">Provider</h2>
        <div className="flex items-center gap-3">
          <select
            value={env.provider === "vapi" ? "vapi" : "retell"}
            disabled
            aria-label="Voice provider"
            className="h-8 rounded-md border border-input bg-transparent px-2 text-sm opacity-80"
          >
            <option value="retell">Retell (active)</option>
            <option value="vapi" disabled>
              Vapi — coming soon
            </option>
          </select>
          <span className="text-xs text-muted-foreground">Chosen by the VOICE_PROVIDER environment variable.</span>
        </div>
        <dl className="grid grid-cols-[120px_1fr] gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">Agent ID</dt>
          <dd className="font-mono text-xs break-all">{env.agentId ?? <Missing />}</dd>
          <dt className="text-muted-foreground">Caller number</dt>
          <dd className="font-mono text-xs">{env.fromNumber ?? <Missing />}</dd>
          <dt className="text-muted-foreground">API key</dt>
          <dd className="text-xs">{env.keySet ? "Set" : <Missing />}</dd>
          <dt className="text-muted-foreground">Human transfer</dt>
          <dd className="text-xs">{env.transferSet ? "Configured" : "Not configured (callback only)"}</dd>
        </dl>
        <p className="text-xs text-muted-foreground">These come from environment variables, not from this page.</p>
      </section>

      <section className="space-y-2 rounded-lg border bg-card p-5">
        <h2 className="text-sm font-semibold">Prompt preview</h2>
        <p className="text-xs text-muted-foreground">
          From <code>prompts/ai-caller.md</code> in the repo. Edit the file, then re-run the setup script to push it
          to the agent.
        </p>
        <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 font-sans text-xs leading-relaxed">
          {prompt}
        </pre>
      </section>
    </div>
  )
}

function Missing() {
  return <span className="text-destructive">Not set</span>
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ease-[var(--ease-out)] active:scale-[0.97] ${
          checked ? "bg-blue-600" : "bg-muted-foreground/30"
        }`}
      >
        <span
          className={`absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow transition-transform duration-200 ease-[var(--ease-out)] ${
            checked ? "translate-x-4" : ""
          }`}
        />
      </button>
    </div>
  )
}
