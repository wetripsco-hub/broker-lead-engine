"use client"

import { useActionState, useEffect, useState } from "react"
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
      <TurnstileWidget onToken={setCaptcha} resetKey={state} />
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
