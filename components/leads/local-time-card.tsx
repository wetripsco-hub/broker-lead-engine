"use client"

import { useEffect, useState } from "react"
import { Clock, MapPin } from "lucide-react"
import { placeName, type RequestLocation } from "@/lib/timezone/viewer-location"
import { useNow } from "@/lib/timezone/use-now"
import {
  AGENT_TZ,
  isValidTimezone,
  resolveTimezone,
  getCallStatus,
  formatLocalTime,
  formatLocalWeekday,
  formatAgentClock,
} from "@/lib/timezone/broker-time"
import { CALL_STATE_STYLES, CALL_WINDOW_LABEL, CallDot, describeCall } from "./call-status"

// "Is it OK to call this broker right now?" — their local time (live), the
// calling-window verdict, and the viewer's own clock: the agent's zone (from
// their IP) as "Your time", or Pakistan for the admin.
export function LocalTimeCard({
  state,
  phone,
  viewerTz = AGENT_TZ,
  isAgent = false,
  adminLocation = null,
}: {
  state: string | null
  phone: string | null
  viewerTz?: string
  isAgent?: boolean
  /** Admin only: where they're opening the page from (extra line; reports stay PKT). */
  adminLocation?: RequestLocation | null
}) {
  const now = useNow(1000)
  const resolved = resolveTimezone(state, phone)
  const tz = isAgent ? viewerTz : AGENT_TZ
  // No IP header (localhost) → the browser's own zone.
  const [browserTz, setBrowserTz] = useState<string | null>(null)
  useEffect(() => {
    try {
      setBrowserTz(Intl.DateTimeFormat().resolvedOptions().timeZone ?? null)
    } catch {
      /* ignore */
    }
  }, [])
  const adminTz = adminLocation ? (adminLocation.timezone ?? (isValidTimezone(browserTz) ? browserTz : null)) : null
  const adminPlace = adminLocation ? placeName(adminLocation.city, adminLocation.country) : null

  const status = now && resolved ? getCallStatus(resolved.tz, now) : null
  const display = status ? describeCall(status, now!, tz) : null
  const styleKey = resolved ? (status?.state ?? "unknown") : "unknown"

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Local time</p>
        {/* Reserve the pill's height while the clock hasn't started so the
            card doesn't jump when it does. */}
        <span
          className={`inline-flex h-5 items-center gap-1.5 rounded-full px-2 text-[11px] font-medium transition-colors duration-200 ease-[var(--ease-out)] ${CALL_STATE_STYLES[styleKey].badge}`}
        >
          {resolved ? (
            status ? (
              <>
                <CallDot state={status.state} />
                {display!.headline}
              </>
            ) : (
              <span className="opacity-0">Outside calling hours</span>
            )
          ) : (
            <>
              <CallDot state="unknown" />
              Timezone unknown
            </>
          )}
        </span>
      </div>

      {resolved ? (
        <div>
          <p className="text-2xl font-semibold tracking-tight tabular-nums leading-none h-7" suppressHydrationWarning>
            {now ? formatLocalTime(resolved.tz, now) : " "}
          </p>
          <p className="text-sm text-muted-foreground mt-1.5 h-5" suppressHydrationWarning>
            {now ? formatLocalWeekday(resolved.tz, now) : " "}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {resolved.zoneLabel}
            {resolved.place ? ` (${resolved.place})` : ""}
          </p>
          {resolved.approximate && (
            <p className="text-[11px] text-muted-foreground/80 mt-1">
              {resolved.source === "area_code"
                ? "Approximate — guessed from the phone area code."
                : `Approximate — ${resolved.place} spans more than one timezone.`}
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No state on this lead and the phone area code isn't recognised, so there's no way to tell
          what time it is for them.
        </p>
      )}

      {display?.detail && (
        <p className="text-xs text-muted-foreground" suppressHydrationWarning>
          {display.detail}
        </p>
      )}

      <div className="border-t pt-3 space-y-1 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <Clock className="size-3 shrink-0" aria-hidden />
          <span className="tabular-nums" suppressHydrationWarning>
            {isAgent ? "Your time" : "Pakistan"}: {now ? formatAgentClock(now, tz) : " "}
          </span>
        </div>
        {!isAgent && adminTz && (
          <div className="flex items-center gap-1.5">
            <MapPin className="size-3 shrink-0" aria-hidden />
            <span className="tabular-nums" suppressHydrationWarning>
              Your current time: {now ? formatAgentClock(now, adminTz) : " "}
              {adminPlace ? ` · ${adminPlace}` : ""}
            </span>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground/70">
          Calling window {CALL_WINDOW_LABEL}, their time
        </p>
      </div>
    </div>
  )
}
