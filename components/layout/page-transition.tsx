"use client"

import { usePathname } from "next/navigation"

// Keys on pathname so each route swap re-triggers the fade/rise-in.
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  return (
    <div key={pathname} className="animate-in-rise" style={{ animationDuration: "220ms" }}>
      {children}
    </div>
  )
}
