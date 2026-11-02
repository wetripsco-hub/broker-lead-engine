"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"

// Sidebar badge for Support. Admin: tickets waiting for an answer. Agent: their
// tickets with an admin answer they haven't opened yet. RLS limits the agent's
// count to their own tickets. Same polling pattern as UnreadSmsBadge.
export function TicketsBadge({ initialCount, isAdmin }: { initialCount: number; isAdmin: boolean }) {
  const [count, setCount] = useState(initialCount)

  useEffect(() => {
    const supabase = createClient()
    async function refresh() {
      const q = (supabase.from("support_tickets") as any).select("id", { count: "exact", head: true })
      const { count: c } = await (isAdmin ? q.eq("status", "open") : q.eq("agent_unread", true))
      setCount(c ?? 0)
    }
    const poll = setInterval(refresh, 15000)
    return () => clearInterval(poll)
  }, [isAdmin])

  // A fresh server render (e.g. after opening a ticket) brings a newer count.
  useEffect(() => setCount(initialCount), [initialCount])

  if (count === 0) return null
  return (
    <span className="ml-auto min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-semibold flex items-center justify-center shrink-0">
      {count > 99 ? "99+" : count}
    </span>
  )
}
