import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { ScriptTabs } from "./script-tabs"

// "Learn your calling script" — for agents and the admin. Read-only, rendered from
// lib/call-script/script.ts (SCRIPT_GOALS, CALLER_NOTES, CALL_SCRIPT) so it always
// matches the dialer's script panel word for word.
export default async function ScriptPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  return (
    <div className="p-3 sm:p-6 max-w-3xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Call script</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Learn it here; the same words show in the script panel during a call. Placeholders like [Name] are filled in
          automatically on a real call.
        </p>
      </div>
      <ScriptTabs />
    </div>
  )
}
