import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ChangePasswordForm } from "./change-password-form"

// Agent only: see the login ID and change your own password.
export default async function AccountPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")
  if (user.app_metadata?.role === "admin") redirect("/dashboard")

  return (
    <div className="p-3 sm:p-6 max-w-lg mx-auto space-y-4">
      <h1 className="text-lg font-semibold tracking-tight">My Account</h1>
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
