import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import type { Database } from "@/types/database"
import { ONBOARDED_COOKIE } from "@/lib/onboarding"

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh session — do not remove
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const isAuthRoute = request.nextUrl.pathname.startsWith("/login")
  const isDashboardRoute =
    request.nextUrl.pathname === "/" ||
    request.nextUrl.pathname.startsWith("/dashboard") ||
    request.nextUrl.pathname.startsWith("/leads") ||
    request.nextUrl.pathname.startsWith("/ingestion") ||
    request.nextUrl.pathname.startsWith("/settings") ||
    request.nextUrl.pathname.startsWith("/company") ||
    request.nextUrl.pathname.startsWith("/requests") ||
    request.nextUrl.pathname.startsWith("/tickets") ||
    request.nextUrl.pathname.startsWith("/account") ||
    request.nextUrl.pathname.startsWith("/support-requests") ||
    request.nextUrl.pathname.startsWith("/onboarding")

  if (!user && isDashboardRoute) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    return NextResponse.redirect(url)
  }

  if (user && isAuthRoute) {
    const url = request.nextUrl.clone()
    url.pathname = "/dashboard"
    return NextResponse.redirect(url)
  }

  // First-login walkthrough: an agent who hasn't finished it is sent to the
  // tour. Admins never are. Once finished, a cookie skips this look-up.
  const path = request.nextUrl.pathname
  const tourExempt =
    isAuthRoute || path.startsWith("/onboarding") || path.startsWith("/api") || path.startsWith("/auth") ||
    path === "/training" || path.startsWith("/training/") || path.startsWith("/sales/")
  if (
    user &&
    !tourExempt &&
    user.app_metadata?.role !== "admin" &&
    request.cookies.get(ONBOARDED_COOKIE)?.value !== user.id
  ) {
    const { data } = await (supabase.from("agents") as any)
      .select("onboarding_completed_at")
      .eq("user_id", user.id)
      .maybeSingle()
    const row = data as { onboarding_completed_at: string | null } | null
    // No row, or the column isn't there yet (query error): leave the agent alone.
    if (row && !row.onboarding_completed_at) {
      const url = request.nextUrl.clone()
      url.pathname = "/onboarding/tour"
      url.search = ""
      return NextResponse.redirect(url)
    }
    if (row?.onboarding_completed_at) {
      supabaseResponse.cookies.set(ONBOARDED_COOKIE, user.id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 12 })
    }
  }

  return supabaseResponse
}
