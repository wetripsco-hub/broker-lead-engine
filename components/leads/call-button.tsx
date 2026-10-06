"use client"

import { useEffect, useState } from "react"
import { Phone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DialerModal } from "./dialer-modal"
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
}

export function CallButton({ leadId, agentId, brokerPhone, brokerName, brokerState }: CallButtonProps) {
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState<{ time: string; weekday: string | null } | null>(null)

  useEffect(() => {
    if (!confirm) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirm(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [confirm])

  if (!brokerPhone) {
    return (
      <Button variant="outline" size="sm" disabled className="gap-2">
        <Phone className="size-3.5" />
        No phone
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
          brokerPhone={brokerPhone}
          brokerName={brokerName}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
