"use client"

import { useActionState, useEffect, useRef } from "react"
import { changeMyPassword, type ChangePasswordState } from "./actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { MIN_PASSWORD_LENGTH } from "@/lib/support-request"

const initialState: ChangePasswordState = { error: null, success: null }

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState(changeMyPassword, initialState)
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (state.success) formRef.current?.reset()
  }, [state])

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="current">Current password</Label>
        <Input id="current" name="current" type="password" required autoComplete="current-password" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="next">New password</Label>
        <Input id="next" name="next" type="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" />
        <p className="text-[11px] text-muted-foreground">At least {MIN_PASSWORD_LENGTH} characters, different from the current one.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm">Confirm new password</Label>
        <Input id="confirm" name="confirm" type="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" />
      </div>
      {state.error && (
        <p role="alert" aria-live="polite" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive animate-in-fade">
          {state.error}
        </p>
      )}
      {state.success && (
        <p role="status" aria-live="polite" className="rounded-md border border-green-600/30 bg-green-600/10 px-3 py-2 text-sm text-green-700 dark:text-green-400 animate-in-fade">
          {state.success}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Change password"}
      </Button>
    </form>
  )
}
