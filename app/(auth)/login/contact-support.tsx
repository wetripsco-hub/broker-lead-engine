"use client"

import { useState } from "react"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { DEFAULT_SUPPORT_MESSAGE, MESSAGE_MAX } from "@/lib/support-request"

export function ContactSupport() {
  const [open, setOpen] = useState(false)
  const [loginId, setLoginId] = useState("")
  const [message, setMessage] = useState(DEFAULT_SUPPORT_MESSAGE)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)

  function close() {
    setOpen(false)
    setError(null)
    setSent(null)
    setMessage(DEFAULT_SUPPORT_MESSAGE)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    try {
      const res = await fetch("/api/support-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId, message }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok) setSent(json.message ?? "Your request has been sent to the admin.")
      else setError(json.error ?? "Could not send your request. Please try again.")
    } catch {
      setError("Could not send your request. Please try again.")
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <p className="mt-4 text-center text-sm text-muted-foreground">
        Can't sign in?{" "}
        <button type="button" onClick={() => setOpen(true)} className="font-medium text-foreground underline-offset-4 hover:underline">
          Contact Support
        </button>
      </p>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="support-title">
          <div className="bg-card border rounded-xl shadow-xl w-full max-w-sm flex flex-col animate-in-fade">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h2 id="support-title" className="font-semibold text-sm">Contact Support</h2>
              <button type="button" onClick={close} aria-label="Close" className="text-muted-foreground hover:text-foreground">
                <X className="size-4" />
              </button>
            </div>
            {sent ? (
              <div className="px-5 py-4 space-y-4">
                <p role="status" className="text-sm">{sent}</p>
                <div className="flex justify-end">
                  <Button size="sm" onClick={close}>Close</Button>
                </div>
              </div>
            ) : (
              <form onSubmit={submit} className="px-5 py-4 space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="support-login-id">Login ID</Label>
                  <Input
                    id="support-login-id"
                    type="email"
                    required
                    autoComplete="email"
                    value={loginId}
                    onChange={(e) => setLoginId(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="support-message">Message</Label>
                  <Textarea
                    id="support-message"
                    required
                    maxLength={MESSAGE_MAX}
                    rows={4}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground text-right tabular-nums">{message.length}/{MESSAGE_MAX}</p>
                </div>
                {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="ghost" size="sm" onClick={close}>Cancel</Button>
                  <Button type="submit" size="sm" disabled={pending}>{pending ? "Sending…" : "Send"}</Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  )
}
