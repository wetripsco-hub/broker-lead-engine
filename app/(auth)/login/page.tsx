import { LoginForm } from "./login-form"
import { ContactSupport } from "./contact-support"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ACCOUNT_DISABLED_MESSAGE } from "@/lib/account-disabled"

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ disabled?: string }> }) {
  const { disabled } = await searchParams
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm px-4">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2 mb-2">
            <div className="size-8 rounded-md bg-foreground" aria-hidden />
            <span className="text-xl font-semibold tracking-tight">Broker Lead Engine</span>
          </div>
          <p className="text-sm text-muted-foreground">Sign in to your account</p>
        </div>

        <Card>
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-base">Welcome back</CardTitle>
            <CardDescription>Enter your email and password to continue</CardDescription>
          </CardHeader>
          <CardContent>
            {disabled === "1" && (
              <p role="alert" className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {ACCOUNT_DISABLED_MESSAGE}
              </p>
            )}
            <LoginForm />
          </CardContent>
        </Card>
        <ContactSupport />
      </div>
    </div>
  )
}
