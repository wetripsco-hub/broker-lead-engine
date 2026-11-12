import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { ONBOARDED_COOKIE } from "@/lib/onboarding"

// A disabled agent who still had a session: sign them out, then show the login page
// with the "contact your admin" message.
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  await supabase.auth.signOut()
  const url = request.nextUrl.clone()
  url.pathname = "/login"
  url.search = "?disabled=1"
  const res = NextResponse.redirect(url)
  res.cookies.delete(ONBOARDED_COOKIE)
  return res
}
