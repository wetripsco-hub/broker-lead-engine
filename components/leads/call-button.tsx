"use client"

import { useEffect, useState } from "react"
import { Phone, Clock, Send } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DialerModal } from "./dialer-modal"
import { CopilotSwitch } from "@/components/copilot/copilot-switch"
import { toE164 } from "@/lib/phone"
import { useNow } from "@/lib/timezone/use-now"
import { requestAfterHoursCall } from "@/app/(dashboard)/leads/[id]/call-actions"
import type { AgentCallState } from "@/lib/agent-call-rules"
import { countdown, useAgentCallState } from "./use-agent-call-state"
import {
  resolveTimezone,
  getCallStatus,
  formatLocalClock,
  formatLocalWeekday,
} from "@/lib/timezone/broker-time"

interface CallButtonProps {
  leadId: string
  agentId: string
  brokerPhone: string | null
  brokerName: string | null
  brokerState: string | null
  /** For the call script panel. */
  contactName?: string | null
  agentName?: string | null
  callbackPhone?: string | null
  /** Lead is flagged do-not-call: the call button is disabled. */
  doNotCall?: boolean
  /**
   * Agents only: calling hours, after-hours requests, hourly limit and broker
   * cooldown apply, and the number is shown masked (`displayPhone`). Admins
   * never pass this and keep the old behaviour.
   */
  agentRules?: { initialState: AgentCallState | null; displayPhone: string | null }
}

export function CallButton(props: CallButtonProps) {
  if (props.agentRules) return <AgentCallButton {...props} agentRules={props.agentRules} />
  return <AdminCallButton {...props} />
}

function AdminCallButton({ leadId, agentId, brokerPhone, brokerName, brokerState, contactName = null, agentName = null, callbackPhone = null, doNotCall = false }: CallButtonProps) {
  const [open, setOpen] = useState(false)
  // Off by default; not remembered between visits so it is never on by accident.
  const [copilotOn, setCopilotOn] = useState(false)
  const [confirm, setConfirm] = useState<{ time: string; weekday: string | null } | null>(null)

  useEffect(() => {
    if (!confirm) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirm(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [confirm])

  if (doNotCall) {
    return (
      <Button variant="outline" size="sm" disabled className="gap-2" title="This lead is marked do-not-call">
        <Phone className="size-3.5" />
        Do not call
      </Button>
    )
  }
  if (!brokerPhone) {
    return (
      <Button variant="outline" size="sm" disabled className="gap-2">
        <Phone className="size-3.5" />
        No phone
      </Button>
    )
  }
  // Telnyx only ever gets E.164. A phone that can't be normalised is not dialled.
  const e164 = toE164(brokerPhone)
  if (!e164) {
    return (
      <Button variant="outline" size="sm" disabled className="gap-2" title={`"${brokerPhone}" is not a valid phone number`}>
        <Phone className="size-3.5" />
        Invalid phone number
      </Button>
    )
  }

  // Never blocks the call — outside the window (or on a weekend) it just asks
  // first. If the broker's timezone can't be worked out, there's nothing to
  // warn about, so it dials straight away.
  function handleClick() {
    const resolved = resolveTimezone(brokerState, brokerPhone)
    if (resolved) {
      const now = new Date()
      const status = getCallStatus(resolved.tz, now)
      if (status.state === "closed" || status.state === "weekend") {
        setConfirm({
          time: formatLocalClock(resolved.tz, now),
          weekday: status.state === "weekend" ? formatLocalWeekday(resolved.tz, now) : null,
        })
        return
      }
    }
    setOpen(true)
  }

  return (
    <>
      <CopilotSwitch on={copilotOn} onChange={setCopilotOn} />
      <Button
        variant="outline"
        size="sm"
        className="gap-2 transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.97]"
        onClick={handleClick}
      >
        <Phone className="size-3.5" />
        Call
      </Button>

      {confirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 animate-in-fade"
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfirm(null)
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="call-confirm-title"
            className="w-full max-w-sm rounded-xl border bg-card p-5 shadow-xl animate-in-rise"
          >
            <h2 id="call-confirm-title" className="text-sm font-semibold">
              Outside calling hours
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Is broker ka abhi {confirm.weekday ? `${confirm.weekday} ` : ""}
              <span className="font-medium text-foreground tabular-nums">{confirm.time}</span> hai. Phir bhi call
              karein?
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.97]"
                onClick={() => setConfirm(null)}
                autoFocus
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="gap-2 transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.97]"
                onClick={() => {
                  setConfirm(null)
                  setOpen(true)
                }}
              >
                <Phone className="size-3.5" />
                Call anyway
              </Button>
            </div>
          </div>
        </div>
      )}

      {open && (
        <DialerModal
          leadId={leadId}
          agentId={agentId}
          brokerPhone={e164}
          brokerName={brokerName}
          copilotOn={copilotOn}
          contactName={contactName}
          agentName={agentName}
          callbackPhone={callbackPhone}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

// ─── Agents ──────────────────────────────────────────────────────────────────
// The server re-checks every one of these rules when the call starts
// (logCallStarted); this only shows the agent where they stand.

function AgentCallButton({
  leadId,
  agentId,
  brokerPhone,
  brokerName,
  contactName = null,
  agentName = null,
  callbackPhone = null,
  doNotCall = false,
  agentRules,
}: CallButtonProps & { agentRules: NonNullable<CallButtonProps["agentRules"]> }) {
  const [open, setOpen] = useState(false)
  const [copilotOn, setCopilotOn] = useState(false)
  const [requestOpen, setRequestOpen] = useState(false)
  const now = useNow()
  const { state, refresh } = useAgentCallState(leadId, agentRules.initialState, true)

  if (doNotCall) {
    return (
      <Button variant="outline" size="sm" disabled className="gap-2" title="This lead is marked do-not-call">
        <Phone className="size-3.5" />
        Do not call
      </Button>
    )
  }
  if (!brokerPhone) {
    return (
      <Button variant="outline" size="sm" disabled className="gap-2">
        <Phone className="size-3.5" />
        No phone
      </Button>
    )
  }
  const e164 = toE164(brokerPhone)
  if (!e164) {
    return (
      <Button variant="outline" size="sm" disabled className="gap-2" title="This broker's phone number is not valid">
        <Phone className="size-3.5" />
        Invalid phone number
      </Button>
    )
  }

  const cooldownLeft = countdown(state?.cooldown.until ?? null, now)
  const hourlyLeft = countdown(state?.hourly.blockedUntil ?? null, now)
  const req = state?.request ?? null
  const grantLeft = req?.status === "granted" ? countdown(req.expiresAt, now) : null
  const inside = state?.window.inside ?? false

  const dialer = open && (
    <DialerModal
      leadId={leadId}
      agentId={agentId}
      brokerPhone={e164}
      displayPhone={agentRules.displayPhone}
      brokerName={brokerName}
      copilotOn={copilotOn}
      contactName={contactName}
      agentName={agentName}
      callbackPhone={callbackPhone}
      callsThisHour={state ? { count: state.hourly.count, limit: state.hourly.limit } : null}
      askSupport
      onClose={() => {
        setOpen(false)
        refresh()
      }}
    />
  )

  if (!state) {
    return (
      <Button variant="outline" size="sm" disabled className="gap-2">
        <Phone className="size-3.5" />
        Checking…
      </Button>
    )
  }
  if (cooldownLeft) {
    return (
      <Button variant="outline" size="sm" disabled className="gap-2 tabular-nums" title={state.cooldown.message ?? undefined}>
        <Clock className="size-3.5" />
        Cooldown · {cooldownLeft}
      </Button>
    )
  }
  if (hourlyLeft) {
    return (
      <Button variant="outline" size="sm" disabled className="gap-2 tabular-nums" title={state.hourly.message ?? undefined}>
        <Clock className="size-3.5" />
        Hourly limit · {hourlyLeft}
      </Button>
    )
  }

  const callButton = (label: React.ReactNode) => (
    <>
      <CopilotSwitch on={copilotOn} onChange={setCopilotOn} />
      <Button
        variant="outline"
        size="sm"
        className="gap-2 tabular-nums transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.97]"
        onClick={() => setOpen(true)}
      >
        <Phone className="size-3.5" />
        {label}
      </Button>
      {dialer}
    </>
  )

  if (inside) return callButton("Call")
  if (grantLeft) return callButton(<>Approved — call within {grantLeft}</>)

  const brokerTime = state.window.brokerTime ? `broker's time: ${state.window.brokerTime}` : "broker's time unknown"
  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Outside calling hours ({brokerTime})</span>
        {req?.status === "pending" ? (
          <Button variant="outline" size="sm" disabled className="gap-2">
            <Clock className="size-3.5" />
            Pending — waiting for admin
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="gap-2 transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.97]"
            onClick={() => setRequestOpen(true)}
          >
            <Send className="size-3.5" />
            Request after-hours call
          </Button>
        )}
      </div>
      {req?.status === "denied" && (
        <span className="text-xs text-destructive">Denied{req.denyReason ? ` (${req.denyReason})` : ""}</span>
      )}
      {(req?.status === "expired" || (req?.status === "granted" && !grantLeft && now !== null)) && (
        <span className="text-xs text-muted-foreground">Expired — send a new request to call.</span>
      )}
      {requestOpen && (
        <AfterHoursRequestDialog
          leadId={leadId}
          onClose={() => setRequestOpen(false)}
          onSent={() => {
            setRequestOpen(false)
            refresh()
          }}
        />
      )}
    </div>
  )
}

function AfterHoursRequestDialog({ leadId, onClose, onSent }: { leadId: string; onClose: () => void; onSent: () => void }) {
  const [note, setNote] = useState("")
  const [sending, setSending] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  async function submit() {
    if (!note.trim() || sending) return
    setSending(true)
    const { error } = await requestAfterHoursCall(leadId, note)
    setSending(false)
    if (error) toast.error(error)
    else {
      toast.success("Request sent to the admin")
      onSent()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 animate-in-fade"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="after-hours-title"
        className="w-full max-w-sm rounded-xl border bg-card p-5 shadow-xl animate-in-rise"
      >
        <h2 id="after-hours-title" className="text-sm font-semibold">
          Request after-hours call
        </h2>
        <label htmlFor="after-hours-note" className="mt-3 block text-sm text-muted-foreground">
          Why do you need to call now?
        </label>
        <textarea
          id="after-hours-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={1000}
          autoFocus
          className="mt-1.5 w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
          placeholder="e.g. Broker asked me to call back at 7 PM their time"
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" className="gap-2" onClick={submit} disabled={!note.trim() || sending}>
            <Send className="size-3.5" />
            {sending ? "Sending…" : "Send request"}
          </Button>
        </div>
      </div>
    </div>
  )
}
