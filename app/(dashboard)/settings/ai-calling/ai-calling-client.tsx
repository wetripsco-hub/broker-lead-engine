"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { saveAiCallingSettings } from "./actions"

interface Props {
  settings: { enabled: boolean; testMode: boolean; testNumbers: string[]; dailyCap: number; allowAdminHoursOverride: boolean }
  env: {
    provider: string
    providerLabel: string
    configured: boolean
    agentLabel: string
    agentId: string | null
    fromLabel: string
    fromNumber: string | null
    keySet: boolean
    webhookSecretSet: boolean | null
    transferSet: boolean
  }
  prompt: string
}

export function AiCallingClient({ settings, env, prompt }: Props) {
  const [enabled, setEnabled] = useState(settings.enabled)
  const [testMode, setTestMode] = useState(settings.testMode)
  const [numbers, setNumbers] = useState(settings.testNumbers.join("\n"))
  const [cap, setCap] = useState(String(settings.dailyCap))
  const [override, setOverride] = useState(settings.allowAdminHoursOverride)
  const [pending, startTransition] = useTransition()

  const dirty =
    enabled !== settings.enabled ||
    testMode !== settings.testMode ||
    numbers.split(/[\n,;]+/).filter(Boolean).join(",") !== settings.testNumbers.join(",") ||
    cap !== String(settings.dailyCap) ||
    override !== settings.allowAdminHoursOverride

  function save() {
    startTransition(async () => {
      const res = await saveAiCallingSettings({ enabled, testMode, testNumbers: numbers, dailyCap: Number(cap), allowAdminHoursOverride: override })
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
        <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
          <Toggle
            label="Allow admin calling-hours override"
            hint="Lets an admin tick “Override calling hours” in the AI Call dialog and skip the 8 AM–6 PM, weekdays check. Agents can never use it. Every use is recorded on the call."
            checked={override}
            onChange={setOverride}
          />
          <p className="text-xs font-medium text-destructive">
            Warning: with this on, real brokers can be called at night or on weekends. Consent, do-not-call, the master switch and the test-number list still always apply.
          </p>
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
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={env.provider}
            disabled
            aria-label="Voice provider"
            className="h-8 rounded-md border border-input bg-transparent px-2 text-sm opacity-80"
          >
            <option value="retell">Retell{env.provider === "retell" ? " (active)" : ""}</option>
            <option value="vapi">Vapi{env.provider === "vapi" ? " (active)" : ""}</option>
          </select>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              env.configured
                ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                : "bg-destructive/10 text-destructive"
            }`}
          >
            {env.providerLabel}: {env.configured ? "configured" : "not fully configured"}
          </span>
          <span className="text-xs text-muted-foreground">Switch with the VOICE_PROVIDER environment variable (retell or vapi).</span>
        </div>
        <dl className="grid grid-cols-[120px_1fr] gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">{env.agentLabel}</dt>
          <dd className="font-mono text-xs break-all">{env.agentId ?? <Missing />}</dd>
          <dt className="text-muted-foreground">{env.fromLabel}</dt>
          <dd className="font-mono text-xs">{env.fromNumber ?? <Missing />}</dd>
          <dt className="text-muted-foreground">API key</dt>
          <dd className="text-xs">{env.keySet ? "Set" : <Missing />}</dd>
          {env.webhookSecretSet !== null && (
            <>
              <dt className="text-muted-foreground">Webhook secret</dt>
              <dd className="text-xs">{env.webhookSecretSet ? "Set" : <Missing />}</dd>
            </>
          )}
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
