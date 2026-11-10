import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ChangePasswordForm } from "./change-password-form"
import { MyTerms } from "@/components/earnings/my-terms"
import type { PayoutDetails } from "@/lib/payout-details"
import { PayoutForm } from "./payout-form"

// Agent only: see the login ID and change your own password.
export default async function AccountPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")
  if (user.app_metadata?.role === "admin") redirect("/dashboard")

  // Own row only (row-level security). Empty if not saved yet or the table is not there yet.
  const { data: payoutRaw } = await (supabase.from("agent_payout_details") as any).select("*").maybeSingle()
  const payout = (payoutRaw ?? null) as PayoutDetails | null

  return (
    <div className="p-3 sm:p-6 max-w-lg mx-auto space-y-4">
      <h1 className="text-lg font-semibold tracking-tight">My Account</h1>
      <MyTerms userId={user.id} />
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Payout details</CardTitle>
          <CardDescription>
            Where your commission is paid on the 15th.
            {payout?.updated_at && ` Last saved ${new Date(payout.updated_at).toLocaleDateString(undefined, { dateStyle: "medium" })}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PayoutForm initial={payout} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Login ID</CardTitle>
          <CardDescription>Your login ID can't be changed.</CardDescription>
        </CardHeader>
        <CardContent>
          <Label htmlFor="login-id" className="sr-only">Login ID</Label>
          <Input id="login-id" value={user.email ?? ""} readOnly disabled className="h-9 text-sm" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Change password</CardTitle>
          <CardDescription>You stay signed in after changing it.</CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </div>
  )
}
