"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"

// Lives in the sidebar (mounted on every dashboard page) so the unread
// count stays live regardless of which page the agent is on. Used for both
// SMS and email: same table, different channel.
export function UnreadSmsBadge({
  initialCount,
  channel = "sms",
}: {
  initialCount: number
  channel?: "sms" | "email"
}) {
  const [count, setCount] = useState(initialCount)

  useEffect(() => {
    const supabase = createClient()

    async function refresh() {
      const { count: c } = await supabase
        .from("outreach_events")
        .select("id", { count: "exact", head: true })
        .eq("channel", channel)
        .eq("direction", "inbound")
        .is("read_at", null)
      setCount(c ?? 0)
    }

    const realtime = supabase
      .channel(`${channel}-unread-badge`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "outreach_events", filter: `channel=eq.${channel}` },
        () => refresh(),
      )
      .subscribe()

    // Realtime push is the fast path; poll as a fallback so the badge still
    // updates within a few seconds if a push is ever missed or delayed.
    const poll = setInterval(refresh, 10000)

    return () => {
      supabase.removeChannel(realtime)
      clearInterval(poll)
    }
  }, [channel])

  if (count === 0) return null

  return (
    <span className="ml-auto min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-semibold flex items-center justify-center shrink-0">
      {count > 99 ? "99+" : count}
    </span>
  )
}
