"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"

// Admin sidebar: open login-screen support requests (RLS: admin only).
export function SupportRequestsBadge({ initialCount }: { initialCount: number }) {
  const [count, setCount] = useState(initialCount)

  useEffect(() => {
    const supabase = createClient()
    async function refresh() {
      const { count: c } = await (supabase.from("support_requests") as any)
        .select("id", { count: "exact", head: true })
        .eq("status", "open")
      setCount(c ?? 0)
    }
    const poll = setInterval(refresh, 15000)
    return () => clearInterval(poll)
  }, [])

  if (count === 0) return null

  return (
    <span className="ml-auto min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-semibold flex items-center justify-center shrink-0">
      {count > 99 ? "99+" : count}
    </span>
  )
}
