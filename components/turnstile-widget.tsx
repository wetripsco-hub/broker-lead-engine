"use client"

// Cloudflare Turnstile widget. Renders nothing when NEXT_PUBLIC_TURNSTILE_SITE_KEY
// is not set. "interaction-only": invisible unless Cloudflare needs the person to
// click. Inside a <form> it adds a hidden "cf-turnstile-response" field itself.

import { useEffect, useRef } from "react"

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string
      reset: (id?: string) => void
      remove: (id: string) => void
    }
  }
}

export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"

let scriptPromise: Promise<void> | null = null
function loadScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve()
  if (window.turnstile) return Promise.resolve()
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script")
      s.src = SCRIPT_SRC
      s.async = true
      s.onload = () => resolve()
      s.onerror = () => {
        scriptPromise = null
        reject(new Error("turnstile script failed"))
      }
      document.head.appendChild(s)
    })
  }
  return scriptPromise
}

/**
 * `resetKey`: change it (e.g. after each submit) to get a fresh single-use token.
 * `onToken`: the current token, or "" while there is none.
 */
export function TurnstileWidget({ onToken, resetKey }: { onToken?: (token: string) => void; resetKey?: unknown }) {
  const ref = useRef<HTMLDivElement>(null)
  const idRef = useRef<string | null>(null)
  const onTokenRef = useRef(onToken)
  onTokenRef.current = onToken

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return
    let cancelled = false
    loadScript()
      .then(() => {
        if (cancelled || !ref.current || !window.turnstile || idRef.current) return
        idRef.current = window.turnstile.render(ref.current, {
          sitekey: TURNSTILE_SITE_KEY,
          appearance: "interaction-only",
          callback: (t: string) => onTokenRef.current?.(t),
          "expired-callback": () => onTokenRef.current?.(""),
          "error-callback": () => onTokenRef.current?.(""),
        })
      })
      .catch(() => {
        // Script blocked or offline: the server lets the request through only if Cloudflare is unreachable there too.
      })
    return () => {
      cancelled = true
      if (idRef.current && window.turnstile) window.turnstile.remove(idRef.current)
      idRef.current = null
    }
  }, [])

  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    if (idRef.current && window.turnstile) {
      onTokenRef.current?.("")
      window.turnstile.reset(idRef.current)
    }
  }, [resetKey])

  if (!TURNSTILE_SITE_KEY) return null
  return <div ref={ref} className="flex justify-center empty:hidden" />
}
