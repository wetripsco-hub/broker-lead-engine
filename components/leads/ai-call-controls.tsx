"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Bot, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { markAiCallConsent } from "@/app/(dashboard)/leads/actions"
import { toE164 } from "@/lib/phone"
import { getCallStatus, resolveTimezone, formatLocalTime } from "@/lib/timezone/broker-time"

interface AiCallControlsProps {
  leadId: string
  brokerName: string | null
  brokerState: string | null
  brokerPhone: string | null
  isAdmin: boolean
  /** Master switch (app_settings.ai_calling_enabled). */
  aiEnabled: boolean
  consent: { granted: boolean; source: string | null; at: string | null }
  doNotCall: boolean
  /** call_status of this lead's most recent AI call, if any. */
  latestCallStatus: string | null
  latestCallAt: string | null
  /** Test mode is on and this lead's number is a listed test number: hours are skipped. */
  testHoursExempt: boolean
  /** Admin + the settings switch is on: the override checkbox may be offered. (UI hint only; the server re-checks.) */
  canOverrideHours: boolean
}

const ACTIVE = ["queued", "registered", "in_progress"]
const STUCK_AFTER_MS = 30 * 60_000

const CHIP: Record<string, { label: string; cls: string }> = {
  queued: { label: "Calling", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
  registered: { label: "Calling", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
  in_progress: { label: "In progress", cls: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300" },
  ended: { label: "Ended", cls: "bg-muted text-muted-foreground" },
}

export function AiCallControls(p: AiCallControlsProps) {
  const router = useRouter()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [consentOpen, setConsentOpen] = useState(false)
  const [source, setSource] = useState("")
  const [overrideHours, setOverrideHours] = useState(false)
  const [pending, startTransition] = useTransition()
  const [now, setNow] = useState<Date | null>(null)

  const recentlyActive =
    p.latestCallStatus != null &&
    ACTIVE.includes(p.latestCallStatus) &&
    p.latestCallAt != null &&
    Date.now() - new Date(p.latestCallAt).getTime() < STUCK_AFTER_MS
  const callActive = recentlyActive

  // Live status: re-read the page's data every few seconds while a call is
  // in flight (the webhook updates the row; the chip follows).
  useEffect(() => {
    if (!callActive) return
    const t = setInterval(() => router.refresh(), 4000)
    return () => clearInterval(t)
  }, [callActive, router])

  useEffect(() => {
    setNow(new Date())
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])

  const tz = resolveTimezone(p.brokerState, p.brokerPhone)
  const windowState = tz && now ? getCallStatus(tz.tz, now).state : null
  const insideWindow = windowState === "ok" || windowState === "closing"

  // Why the button is disabled (server re-checks everything regardless).
  let reason: string | null = null
  if (!p.brokerPhone) reason = "No phone number"
  else if (!toE164(p.brokerPhone)) reason = "Invalid phone number"
  else if (p.doNotCall) reason = "Marked do-not-call"
  else if (!p.aiEnabled) reason = "AI calling is off (admin setting)"
  else if (!p.consent.granted) reason = "No AI-call consent on file"
  else if (callActive) reason = "AI call in progress"

  function place() {
    startTransition(async () => {
      try {
        const res = await fetch("/api/ai-calls/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadId: p.leadId, hoursOverride: overrideHours && p.canOverrideHours && !p.testHoursExempt }),
        })
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        if (!res.ok) {
          toast.error(json.error ?? "Couldn't start the AI call")
        } else {
          toast.success("AI call started")
          setConfirmOpen(false)
          router.refresh()
        }
      } catch {
        toast.error("Couldn't reach the server")
      }
    })
  }

  function saveConsent() {
    startTransition(async () => {
      const { error } = await markAiCallConsent(p.leadId, source)
      if (error) toast.error(error)
      else {
        toast.success("Consent recorded")
        setConsentOpen(false)
        setSource("")
        router.refresh()
      }
    })
  }

  const chip = p.latestCallStatus ? CHIP[p.latestCallStatus] : null

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {chip && (
          <span
            role="status"
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${chip.cls}`}
          >
            {callActive && <span className="size-1.5 animate-pulse rounded-full bg-current" aria-hidden />}
            {chip.label}
          </span>
        )}
        {p.isAdmin && !p.consent.granted && !p.doNotCall && (
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setConsentOpen(true)}>
            <ShieldCheck className="size-3.5" />
            Mark consent
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="gap-2 transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.97]"
          disabled={!!reason || pending}
          onClick={() => setConfirmOpen(true)}
        >
          <Bot className="size-3.5" />
          AI Call
        </Button>
      </div>
      {reason && <p className="text-xs text-muted-foreground">{reason}</p>}

      {confirmOpen && (
        <Dialog onClose={() => !pending && setConfirmOpen(false)} title="Place an AI call?">
          <ul className="space-y-2 text-sm">
            <li>
              <span className="text-muted-foreground">Consent: </span>
              {p.consent.source ?? "on file"}
              {p.consent.at ? ` (${new Date(p.consent.at).toLocaleDateString()})` : ""}
            </li>
            <li>
              <span className="text-muted-foreground">Broker&apos;s local time: </span>
              {tz && now ? (
                <>
                  <span className="tabular-nums">{formatLocalTime(tz.tz, now)}</span>
                  {tz.approximate && <span className="text-muted-foreground"> (approximate)</span>}
                </>
              ) : (
                "unknown"
              )}
            </li>
            <li className="text-muted-foreground">
              This is an AI voice. She introduces herself as Sarah, a virtual assistant from Load Linkers, and says the
              call may be recorded — disclosure is on.
            </li>
          </ul>
          {p.testHoursExempt ? (
            <p className="mt-3 rounded-md bg-blue-500/10 px-3 py-2 text-xs text-blue-800 dark:text-blue-300">
              Test mode: calling hours skipped.
            </p>
          ) : (
            windowState &&
            !insideWindow && (
              <div className="mt-3 space-y-2">
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  Outside 8 AM–6 PM weekdays in the broker&apos;s time.
                  {p.canOverrideHours ? " Tick the box below to override." : " The call will be blocked."}
                </p>
                {p.canOverrideHours && (
                  <label className="flex cursor-pointer items-start gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={overrideHours}
                      onChange={(e) => setOverrideHours(e.target.checked)}
                      className="mt-0.5 size-3.5"
                    />
                    <span>
                      Override calling hours <span className="text-muted-foreground">(admin; this is recorded on the call)</span>
                    </span>
                  </label>
                )}
              </div>
            )
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirmOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button size="sm" className="gap-2" onClick={place} disabled={pending || (!p.testHoursExempt && windowState !== null && !insideWindow && !(p.canOverrideHours && overrideHours))}>
              <Bot className="size-3.5" />
              {pending ? "Starting…" : `Call ${p.brokerName ?? "broker"}`}
            </Button>
          </div>
        </Dialog>
      )}

      {consentOpen && (
        <Dialog onClose={() => !pending && setConsentOpen(false)} title="Record AI-call consent">
          <p className="text-sm text-muted-foreground">
            Confirm this broker agreed to receive calls from the AI agent, and note where that consent came from.
          </p>
          <label className="mt-3 block text-xs text-muted-foreground" htmlFor="consent-source">
            Source (required)
          </label>
          <textarea
            id="consent-source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            rows={3}
            placeholder="e.g. Replied YES to email on 3 Oct; verbal OK on call 4 Oct"
            className="mt-1 w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            autoFocus
          />
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConsentOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button size="sm" onClick={saveConsent} disabled={pending || !source.trim()}>
              {pending ? "Saving…" : "Record consent"}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  )
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 animate-in-fade"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-xl border bg-card p-5 text-left shadow-xl animate-in-rise"
      >
        <h2 className="mb-3 text-sm font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  )
}
