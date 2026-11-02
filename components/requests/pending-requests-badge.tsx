"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"

// Admin sidebar: after-hours call requests waiting for a decision. Same
// pattern as UnreadSmsBadge (RLS lets only the admin count every agent's rows).
export function PendingRequestsBadge({ initialCount }: { initialCount: number }) {
  const [count, setCount] = useState(initialCount)

  useEffect(() => {
    const supabase = createClient()

    async function refresh() {
      const { count: c } = await (supabase.from("after_hours_requests") as any)
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
      setCount(c ?? 0)
    }

    const realtime = supabase
      .channel("after-hours-requests-badge")
      .on("postgres_changes", { event: "*", schema: "public", table: "after_hours_requests" }, () => refresh())
      .subscribe()
    // Realtime only fires if the table is in the realtime publication; the
    // poll keeps the badge current either way.
    const poll = setInterval(refresh, 10000)

    return () => {
      supabase.removeChannel(realtime)
      clearInterval(poll)
    }
  }, [])

  if (count === 0) return null

  return (
    <span className="ml-auto min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-semibold flex items-center justify-center shrink-0">
      {count > 99 ? "99+" : count}
    </span>
  )
}
