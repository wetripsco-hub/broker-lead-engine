import { NextResponse, type NextRequest } from "next/server"
import { updateSession } from "@/lib/supabase/middleware"
import { apiRuleFor, clientIp, hitRateLimit } from "@/lib/rate-limit"

export async function middleware(request: NextRequest) {
  // Per-IP rate limit on /api/* (provider webhooks and email tracking excepted).
  const rule = apiRuleFor(request.nextUrl.pathname)
  if (rule && !(await hitRateLimit(rule, clientIp(request.headers)))) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down and try again shortly." },
      { status: 429, headers: { "Retry-After": String(rule.windowSeconds) } },
    )
  }
  return await updateSession(request)
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|pdf|mp4)$).*)",
  ],
}
