"use client"

import { useActionState, useEffect, useMemo, useState } from "react"
import { login, type LoginState } from "./actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { TURNSTILE_SITE_KEY, TurnstileWidget } from "@/components/turnstile-widget"

const initialState: LoginState = { error: null }

export function LoginForm() {
  const [state, formAction, pending] = useActionState(login, initialState)
  // Browser time zone — fallback for the agent's zone when there's no IP header.
  const [tz, setTz] = useState("")
  // Bot check token (only when Turnstile is configured). Single-use: a fresh one after every attempt.
  const [captcha, setCaptcha] = useState("")
  const waitingForCheck = !!TURNSTILE_SITE_KEY && !captcha
  // If the check has not finished after 10 seconds (ad-blocker, Private Relay, old browser...), say what to try.
  const [retry, setRetry] = useState(0)
  const [stalled, setStalled] = useState(false)
  useEffect(() => {
    if (!waitingForCheck) {
      setStalled(false)
      return
    }
    const t = setTimeout(() => setStalled(true), 10_000)
    return () => clearTimeout(t)
  }, [waitingForCheck, retry])
  const widgetKey = useMemo(() => ({ state, retry }), [state, retry])
  useEffect(() => {
    try {
      setTz(Intl.DateTimeFormat().resolvedOptions().timeZone ?? "")
    } catch {
      /* ignore */
    }
  }, [])

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="tz" value={tz} />
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" placeholder="you@example.com" required autoComplete="email" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" required autoComplete="current-password" />
      </div>
      <TurnstileWidget onToken={setCaptcha} resetKey={widgetKey} appearance="always" />
      {stalled && waitingForCheck && (
        <div role="status" className="space-y-2 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-200">
          <p>The browser check is not finishing. Turn off any ad-blocker or iCloud Private Relay for this page, then try again. If it keeps failing, use Contact Support below.</p>
          <button
            type="button"
            className="font-medium underline"
            onClick={() => {
              setStalled(false)
              setRetry((n) => n + 1)
            }}
          >
            Try again
          </button>
        </div>
      )}
      {state.error && (
        <p
          role="alert"
          aria-live="polite"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive animate-in-fade"
        >
          {state.error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending || waitingForCheck}>
        {pending ? "Signing in…" : waitingForCheck ? "Checking your browser…" : "Sign in"}
      </Button>
    </form>
  )
}
