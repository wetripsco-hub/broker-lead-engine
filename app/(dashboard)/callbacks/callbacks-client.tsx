"use client"

import Link from "next/link"
import { useMemo, useState, useTransition } from "react"
import { Check, Play, RotateCcw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { MISSED_REASON_LABEL, DEFAULT_GREETING } from "@/lib/callbacks/rules"
import type { InboundSettingsRow } from "@/lib/callbacks/server"
import { CallbackNumberCard } from "@/components/leads/callback-number-card"
import { getVoicemailUrl, saveInboundSettings, setCallbackHandled } from "./actions"

export interface CallbackItem {
  id: string
  leadId: string | null
  companyName: string | null
  /** Admin only; null for agents. */
  caller: string | null
  agentName: string | null
  assignedAgentName: string | null
  status: "ringing" | "forwarding" | "answered" | "missed" | "voicemail"
  missedReason: string | null
  receivedAt: string
  hasRecording: boolean
  recordingSeconds: number | null
  transcript: string | null
  transcriptStatus: string | null
  handledAt: string | null
}

const STATUS_STYLE: Record<string, string> = {
  answered: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  missed: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  voicemail: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  ringing: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  forwarding: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
}

const STATUS_LABEL: Record<string, string> = {
  answered: "Answered",
  missed: "Missed",
  voicemail: "Voicemail",
  ringing: "Ringing",
  forwarding: "Ringing",
}

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

function VoicemailPlayer({ id }: { id: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [pending, start] = useTransition()
  if (url) return <audio controls autoPlay preload="none" src={url} onError={() => setUrl(null)} className="h-8 w-full max-w-xs" />
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await getVoicemailUrl(id)
          if (r.url) setUrl(r.url)
          else toast.error(r.error ?? "Recording not available")
        })
      }
      className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline disabled:opacity-50 dark:text-blue-400"
    >
      <Play className="size-3" />
      {pending ? "Loading…" : "Play voicemail"}
    </button>
  )
}

function HandledButton({ item }: { item: CallbackItem }) {
  const [pending, start] = useTransition()
  const handled = !!item.handledAt
  return (
    <Button
      size="sm"
      variant={handled ? "ghost" : "outline"}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await setCallbackHandled(item.id, !handled)
          if (r.error) toast.error(r.error)
        })
      }
    >
      {handled ? <RotateCcw className="size-3.5" /> : <Check className="size-3.5" />}
      {handled ? "Reopen" : "Mark handled"}
    </Button>
  )
}

function CallbackCard({ item, isAdmin }: { item: CallbackItem; isAdmin: boolean }) {
  const name = item.companyName ?? "Unknown caller"
  return (
    <li className={`rounded-xl border bg-card p-3 sm:p-4 ${item.handledAt ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            {item.leadId ? (
              <Link href={`/leads/${item.leadId}`} className="truncate hover:underline">
                {name}
              </Link>
            ) : (
              <span className="truncate">{name}</span>
            )}
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[item.status] ?? ""}`}>
              {STATUS_LABEL[item.status] ?? item.status}
            </span>
            {item.handledAt && <span className="text-xs text-muted-foreground">Handled</span>}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {when(item.receivedAt)}
            {isAdmin && item.caller ? ` · ${item.caller}` : ""}
            {item.missedReason && item.status !== "answered" ? ` · ${MISSED_REASON_LABEL[item.missedReason] ?? item.missedReason}` : ""}
          </p>
          {isAdmin && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Assigned: {item.assignedAgentName ?? "—"}
              {item.agentName && item.agentName !== item.assignedAgentName ? ` · last called by ${item.agentName}` : ""}
            </p>
          )}
        </div>
        {isAdmin && <HandledButton item={item} />}
      </div>
      {(item.hasRecording || item.transcript || item.transcriptStatus) && (
        <div className="mt-3 space-y-2 border-t pt-3">
          {item.hasRecording && (
            <div className="flex flex-wrap items-center gap-3">
              <VoicemailPlayer id={item.id} />
              {item.recordingSeconds !== null && <span className="text-xs text-muted-foreground tabular-nums">{item.recordingSeconds}s</span>}
            </div>
          )}
          <p className="whitespace-pre-wrap text-sm leading-snug">
            {item.transcript ? (
              <>&ldquo;{item.transcript}&rdquo;</>
            ) : (
              <span className="text-xs italic text-muted-foreground">
                {item.transcriptStatus === "pending"
                  ? "Transcribing…"
                  : item.transcriptStatus === "empty"
                    ? "No words in this voicemail."
                    : item.transcriptStatus === "failed"
                      ? "Transcript not available."
                      : ""}
              </span>
            )}
          </p>
        </div>
      )}
    </li>
  )
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "Asia/Karachi", "UTC"]

function SettingsPanel({ settings, callbackNumber }: { settings: InboundSettingsRow; callbackNumber: string }) {
  const [forwardTo, setForwardTo] = useState(settings.forward_to ?? "")
  const [ring, setRing] = useState(String(settings.ring_timeout_secs))
  const [hoursEnabled, setHoursEnabled] = useState(settings.hours_enabled)
  const [timezone, setTimezone] = useState(settings.timezone)
  const [days, setDays] = useState<number[]>(settings.open_days)
  const [openTime, setOpenTime] = useState(settings.open_time)
  const [closeTime, setCloseTime] = useState(settings.close_time)
  const [greeting, setGreeting] = useState(settings.greeting)
  const [notifyEmail, setNotifyEmail] = useState(settings.notify_email ?? "")
  const [pending, start] = useTransition()
  const input = "h-8 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
  const zones = ZONES.includes(timezone) ? ZONES : [timezone, ...ZONES]

  return (
    <form
      className="max-w-2xl space-y-5 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault()
        start(async () => {
          const r = await saveInboundSettings({
            forwardTo,
            ringTimeoutSecs: Number(ring),
            hoursEnabled,
            timezone,
            openDays: days,
            openTime,
            closeTime,
            greeting,
            notifyEmail,
          })
          if (r.error) toast.error(r.error)
          else toast.success("Callback settings saved")
        })
      }}
    >
      <p className="text-sm text-muted-foreground">
        Brokers call back on <span className="font-mono font-medium text-foreground">{callbackNumber || "our Telnyx number"}</span>. During
        business hours the call rings the forwarding phone; if nobody answers (or outside hours) the caller hears the greeting and can
        leave a voicemail.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1.5 text-xs text-muted-foreground">
          Forwarding phone number (your mobile)
          <input type="tel" value={forwardTo} onChange={(e) => setForwardTo(e.target.value)} placeholder="+1 214 555 0100" className={`${input} w-full`} />
        </label>
        <label className="space-y-1.5 text-xs text-muted-foreground">
          Ring for (seconds)
          <input type="number" min={5} max={60} value={ring} onChange={(e) => setRing(e.target.value)} className={`${input} w-full`} />
          <span className="block">Keep it shorter than your phone&apos;s own voicemail pick-up (usually 25–30 s).</span>
        </label>
      </div>

      <fieldset className="space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={hoursEnabled} onChange={(e) => setHoursEnabled(e.target.checked)} />
          Only ring my phone during business hours
        </label>
        <div className={`flex flex-wrap items-center gap-2 ${hoursEnabled ? "" : "pointer-events-none opacity-50"}`}>
          {DAYS.map((d, i) => (
            <button
              key={d}
              type="button"
              aria-pressed={days.includes(i)}
              onClick={() => setDays((cur) => (cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i]))}
              className={`h-8 rounded-md border px-2.5 text-xs transition-colors ${days.includes(i) ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent"}`}
            >
              {d}
            </button>
          ))}
          <input type="time" value={openTime} onChange={(e) => setOpenTime(e.target.value)} className={input} aria-label="Opens at" />
          <span className="text-xs text-muted-foreground">to</span>
          <input type="time" value={closeTime} onChange={(e) => setCloseTime(e.target.value)} className={input} aria-label="Closes at" />
          <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className={input} aria-label="Time zone">
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </div>
      </fieldset>

      <label className="block space-y-1.5 text-xs text-muted-foreground">
        Voicemail greeting (read out before the beep)
        <textarea value={greeting} onChange={(e) => setGreeting(e.target.value)} rows={4} maxLength={1000} className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring" />
        <button type="button" onClick={() => setGreeting(DEFAULT_GREETING)} className="text-xs text-blue-600 hover:underline dark:text-blue-400">
          Reset to default
        </button>
      </label>

      <label className="block space-y-1.5 text-xs text-muted-foreground">
        Email missed callbacks and voicemails to (blank = every admin)
        <input type="text" value={notifyEmail} onChange={(e) => setNotifyEmail(e.target.value)} placeholder="you@example.com" className={`${input} w-full`} />
      </label>

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Save settings"}
      </Button>
    </form>
  )
}

export function CallbacksClient({
  items,
  isAdmin,
  settings,
  callbackNumber,
  agentName = null,
}: {
  items: CallbackItem[]
  isAdmin: boolean
  settings: InboundSettingsRow | null
  callbackNumber: string
  agentName?: string | null
}) {
  const [tab, setTab] = useState<"list" | "settings">("list")
  const [openOnly, setOpenOnly] = useState(isAdmin)
  const shown = useMemo(
    () => (openOnly ? items.filter((i) => !i.handledAt && (i.status === "missed" || i.status === "voicemail")) : items),
    [items, openOnly],
  )
  const openCount = items.filter((i) => !i.handledAt && (i.status === "missed" || i.status === "voicemail")).length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Callbacks</h1>
          <p className="text-sm text-muted-foreground">
            {isAdmin ? "Brokers calling our number back." : "Brokers on your leads who called back."}
          </p>
        </div>
        {isAdmin && (
          <div className="flex rounded-lg border p-0.5 text-sm">
            {(["list", "settings"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`rounded-md px-3 py-1 transition-colors ${tab === t ? "bg-accent font-medium" : "text-muted-foreground hover:text-foreground"}`}
              >
                {t === "list" ? "Callbacks" : "Settings"}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* The number brokers call back on: to say in voicemails, or paste into a text / email. */}
      <div className="max-w-xl">
        <CallbackNumberCard brokerName={null} agentName={agentName} />
      </div>

      {tab === "settings" && settings ? (
        <SettingsPanel settings={settings} callbackNumber={callbackNumber} />
      ) : (
        <>
          <div className="flex gap-2 text-sm">
            <button
              type="button"
              aria-pressed={openOnly}
              onClick={() => setOpenOnly(true)}
              className={`rounded-full border px-3 py-1 ${openOnly ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
            >
              Needs attention ({openCount})
            </button>
            <button
              type="button"
              aria-pressed={!openOnly}
              onClick={() => setOpenOnly(false)}
              className={`rounded-full border px-3 py-1 ${!openOnly ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
            >
              All ({items.length})
            </button>
          </div>
          {shown.length === 0 ? (
            <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              {openOnly ? "Nothing waiting. Every missed callback and voicemail has been handled." : "No callbacks yet."}
            </p>
          ) : (
            <ul className="space-y-2">
              {shown.map((i) => (
                <CallbackCard key={i.id} item={i} isAdmin={isAdmin} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
