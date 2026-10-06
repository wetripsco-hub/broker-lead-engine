"use client"

import { useEffect, useState } from "react"

// Current time as React state. Starts as null and only gets a value after
// mount, so the server render and the first client render agree (the server
// has no business guessing what time the browser thinks it is) and there's
// no hydration mismatch. Also refreshes immediately when the tab becomes
// visible again, since browsers throttle timers in background tabs.
export function useNow(intervalMs = 1000): Date | null {
  const [now, setNow] = useState<Date | null>(null)

  useEffect(() => {
    const tick = () => setNow(new Date())
    tick()
    const id = setInterval(tick, intervalMs)
    const onVisible = () => {
      if (document.visibilityState === "visible") tick()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [intervalMs])

  return now
}
