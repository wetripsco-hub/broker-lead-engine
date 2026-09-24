"use client"

import { usePathname } from "next/navigation"

// Keys on pathname so each route swap re-triggers the fade-in.
//
// Deliberately opacity-only (not animate-in-rise): this div wraps every
// page's content, so any page that renders a `position: fixed` modal has
// it as an ancestor. A transform-based animation with fill-mode "both"
// leaves a non-"none" computed transform (a matrix, even once resolved to
// identity) on the element after it finishes, which makes it the
// containing block for fixed descendants instead of the viewport — fixed
// modals then render relative to this div's full scrollable height
// instead of the visible viewport, invisible on any tall/scrolled page.
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  return (
    <div key={pathname} className="animate-in-fade" style={{ animationDuration: "220ms" }}>
      {children}
    </div>
  )
}
