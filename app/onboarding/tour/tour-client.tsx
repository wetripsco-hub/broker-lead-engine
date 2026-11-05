"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, ArrowRight, Check, Clock, Lock, Mic, Phone, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CALL_END_HOUR, CALL_START_HOUR, formatAgentTimeAt } from "@/lib/timezone/broker-time"
import { MAX_UNANSWERED_TRIES, COOLDOWN_MINUTES } from "@/lib/call-cooldown"
import { DISPOSITION_LABEL, DISPOSITION_MENU } from "@/lib/call-dispositions"
import { TOUR_STEP_COUNT } from "@/lib/onboarding"
import { completeOnboarding, saveOnboardingStep } from "./actions"

interface Props {
  initialStep: number
  replay: boolean
  agentFirstName: string
  hourlyCallLimit: number
  /** The agent's own zone (from their IP), for the example clock. */
  agentTz: string
}

// The mock's example moment: 10:42 AM Central (winter) = 16:42 UTC.
const EXAMPLE_INSTANT = new Date("2026-01-15T16:42:00Z")

const hour12 = (h: number) => `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`

// ── Mock screens ────────────────────────────────────────────────────────────
// Small static pictures of the real screens; nothing in them is clickable.

function MockFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden" aria-hidden>
      <div className="flex items-center gap-1.5 border-b bg-muted/50 px-3 py-2">
        <span className="size-2 rounded-full bg-foreground/15" />
        <span className="size-2 rounded-full bg-foreground/15" />
        <span className="size-2 rounded-full bg-foreground/15" />
        <span className="ml-2 text-[11px] text-muted-foreground">{title}</span>
      </div>
      <div className="p-4 text-xs">{children}</div>
    </div>
  )
}

const STAGES = [
  { key: "new", label: "New", hint: "Not contacted yet", cls: "bg-blue-500/10 text-blue-700 dark:text-blue-400" },
  { key: "contacted", label: "Contacted", hint: "You reached out", cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  { key: "interested", label: "Interested", hint: "Wants to hear more", cls: "bg-violet-500/10 text-violet-700 dark:text-violet-400" },
  { key: "converted", label: "Converted", hint: "Signed up", cls: "bg-green-600/10 text-green-700 dark:text-green-400" },
  { key: "dead", label: "Dead", hint: "Not a fit / said no", cls: "bg-muted text-muted-foreground" },
]

function StagePill({ i }: { i: number }) {
  const s = STAGES[i]
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${s.cls}`}>{s.label}</span>
}

function WelcomeMock() {
  return (
    <MockFrame title="Company">
      <p className="font-semibold text-sm">Loadlinkers</p>
      <p className="mt-1 text-muted-foreground">Rate-con &amp; TMS software for freight brokers</p>
      <div className="mt-3 space-y-1.5">
        {["Who we sell to: newly registered brokers", "What we sell: rate confirmations + TMS", "Pricing, trial & FAQs"].map((t) => (
          <div key={t} className="rounded-md bg-muted px-2.5 py-1.5">{t}</div>
        ))}
      </div>
    </MockFrame>
  )
}

function LeadsMock() {
  const rows = [
    ["Atlas Freight LLC", "MC-1584211", 0],
    ["Blue Route Logistics", "MC-1584390", 1],
    ["Cedar Line Brokerage", "MC-1584402", 2],
    ["Delta Haul Inc", "MC-1584517", 4],
  ] as const
  return (
    <MockFrame title="Leads — assigned to you">
      <div className="mb-3 flex gap-1.5">
        <span className="rounded-md border px-2 py-1 text-muted-foreground">Search…</span>
        <span className="rounded-md border px-2 py-1">Stage: All ▾</span>
        <span className="rounded-md border px-2 py-1">State ▾</span>
      </div>
      <div className="divide-y rounded-md border">
        {rows.map(([n, mc, s]) => (
          <div key={mc} className="flex items-center gap-2 px-2.5 py-2">
            <span className="font-medium">{n}</span>
            <span className="font-mono text-[10px] text-muted-foreground">{mc}</span>
            <span className="ml-auto"><StagePill i={s} /></span>
          </div>
        ))}
      </div>
    </MockFrame>
  )
}

function LeadPageMock() {
  return (
    <MockFrame title="Lead — Atlas Freight LLC">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">FMCSA profile</p>
          <p>MC-1584211 · DOT 4021187</p>
          <p className="flex items-center gap-1"><Lock className="size-3" /> (312) •••-••47</p>
          <p className="flex items-center gap-1"><Lock className="size-3" /> j•••@a•••.com</p>
          <p className="text-muted-foreground">Chicago, IL · Authorized</p>
        </div>
        <div className="space-y-1.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Stage</p>
          <span className="inline-block rounded-md border px-2 py-1">Contacted ▾</span>
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground pt-1">Notes</p>
          <div className="rounded-md border px-2 py-1 text-muted-foreground">Asked for a demo Tue…</div>
        </div>
      </div>
      <p className="mt-3 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Timeline</p>
      <div className="mt-1 space-y-1">
        <div className="rounded-md bg-muted px-2.5 py-1.5">Call · 3 min · Callback requested</div>
        <div className="rounded-md bg-muted px-2.5 py-1.5">Note · “Owner is Jim, call after 2 PM”</div>
      </div>
    </MockFrame>
  )
}

function CallMock({ limit, agentTz }: { limit: number; agentTz: string }) {
  return (
    <MockFrame title="Lead — calling">
      <div className="flex flex-wrap gap-2">
        <span className="rounded-md border px-2 py-1">Broker time 10:42 AM CST</span>
        <span className="rounded-md border px-2 py-1 text-muted-foreground">
          You {formatAgentTimeAt(EXAMPLE_INSTANT, EXAMPLE_INSTANT, agentTz)}
        </span>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-primary-foreground"><Phone className="size-3" /> Call</span>
        <span className="text-muted-foreground">Calls this hour: 6/{limit}</span>
      </div>
      <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-amber-800 dark:text-amber-300">
        <p className="flex items-center gap-1 font-medium"><Clock className="size-3" /> Outside calling hours</p>
        <p className="mt-0.5">Request after-hours call → admin approves</p>
      </div>
    </MockFrame>
  )
}

function ScriptMock({ name }: { name: string }) {
  return (
    <MockFrame title="Call script — opening">
      <div className="space-y-2">
        <div className="rounded-lg bg-primary/10 px-3 py-2">“Hi, this is <b>{name}</b> with Loadlinkers.”</div>
        <div className="rounded-lg bg-primary/10 px-3 py-2">“Just so you know, <b>this call may be recorded</b>.”</div>
        <div className="flex items-center gap-1.5 pt-1 text-muted-foreground">
          <span className="size-2 rounded-full bg-red-600" /> Recording · transcript saved for admin review
        </div>
      </div>
    </MockFrame>
  )
}

function AfterCallMock() {
  return (
    <MockFrame title="Call ended — save outcome">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Disposition</p>
      <div className="mt-1 flex flex-wrap gap-1">
        {DISPOSITION_MENU.slice(0, 6).map((d, i) => (
          <span key={d} className={`rounded-md border px-2 py-0.5 ${i === 3 ? "border-primary bg-primary/10" : ""}`}>{DISPOSITION_LABEL[d]}</span>
        ))}
      </div>
      <p className="mt-3 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Stage</p>
      <span className="mt-1 inline-block rounded-md border px-2 py-1">Interested ▾</span>
      <p className="mt-3 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Note</p>
      <div className="mt-1 rounded-md border px-2 py-1 text-muted-foreground">Call back Thu 11 AM their time</div>
    </MockFrame>
  )
}

function AccountMock() {
  return (
    <MockFrame title="My Account">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Login ID (can't change)</p>
      <div className="mt-1 rounded-md border bg-muted px-2 py-1 text-muted-foreground">you@loadlinkers.co</div>
      <div className="mt-3 space-y-1.5">
        {["Current password", "New password", "Confirm new password"].map((l) => (
          <div key={l} className="rounded-md border px-2 py-1 text-muted-foreground">{l}</div>
        ))}
      </div>
      <p className="mt-3 text-muted-foreground">Forgot it? Login screen → <span className="text-foreground underline">Contact Support</span></p>
    </MockFrame>
  )
}

// ── Mic test ────────────────────────────────────────────────────────────────

function MicTest() {
  const [state, setState] = useState<"idle" | "testing" | "ok" | "denied" | "error">("idle")
  const [level, setLevel] = useState(0)
  const stopRef = useRef<() => void>(() => {})

  useEffect(() => () => stopRef.current(), [])

  async function start() {
    stopRef.current()
    setState("testing")
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const ctx = new AudioContext()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      ctx.createMediaStreamSource(stream).connect(analyser)
      const buf = new Uint8Array(analyser.fftSize)
      let raf = 0
      let heard = false
      const tick = () => {
        analyser.getByteTimeDomainData(buf)
        let peak = 0
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128))
        const l = Math.min(1, peak / 64)
        if (l > 0.08) heard = true
        setLevel(l)
        raf = requestAnimationFrame(tick)
      }
      tick()
      const stop = () => {
        cancelAnimationFrame(raf)
        stream.getTracks().forEach((t) => t.stop())
        ctx.close().catch(() => {})
        setLevel(0)
      }
      stopRef.current = stop
      setTimeout(() => {
        stop()
        stopRef.current = () => {}
        setState(heard ? "ok" : "error")
      }, 5000)
    } catch (e) {
      setState(e instanceof DOMException && e.name === "NotAllowedError" ? "denied" : "error")
    }
  }

  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={start} disabled={state === "testing"}>
          <Mic className="size-3.5" />
          {state === "testing" ? "Listening… say something" : "Test my mic"}
        </Button>
        <div className="h-2 flex-1 rounded-full bg-muted overflow-hidden" aria-hidden>
          <div className="h-full bg-green-600 transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} />
        </div>
      </div>
      {state === "ok" && <p className="text-xs text-green-700 dark:text-green-400 flex items-center gap-1"><Check className="size-3.5" /> Your mic works.</p>}
      {state === "denied" && <p className="text-xs text-destructive">Microphone is blocked. Click the lock icon in the address bar, allow the microphone, and try again.</p>}
      {state === "error" && <p className="text-xs text-destructive">We didn&apos;t hear anything. Check your headset is plugged in and selected, then try again.</p>}
    </div>
  )
}

// ── Tour ────────────────────────────────────────────────────────────────────

export function TourClient({ initialStep, replay, agentFirstName, hourlyCallLimit, agentTz }: Props) {
  const router = useRouter()
  const [step, setStep] = useState(initialStep)
  const [finishing, startFinish] = useTransition()

  const steps: { title: string; lines: React.ReactNode[]; mock: React.ReactNode; extra?: React.ReactNode }[] = [
    {
      title: "Welcome to Loadlinkers",
      lines: [
        "Loadlinkers sells rate-con and TMS software to freight brokers.",
        "Your leads are brokers who just got their FMCSA authority — they need these tools right now.",
        <>
          Everything about the product, pricing and how we pitch it is on the{" "}
          <Link href="/company" target="_blank" className="font-medium underline underline-offset-4">Company page</Link> (read-only).
        </>,
      ],
      mock: <WelcomeMock />,
    },
    {
      title: "Your leads",
      lines: [
        "You only see leads assigned to you. Admin assigns them.",
        "Use search and the Stage / State filters at the top of the Leads page to narrow the list.",
        "Each lead has a stage that shows where it stands:",
      ],
      mock: <LeadsMock />,
      extra: (
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {STAGES.map((s, i) => (
            <li key={s.key} className="flex items-center gap-2 text-sm">
              <StagePill i={i} /> <span className="text-muted-foreground">{s.hint}</span>
            </li>
          ))}
        </ul>
      ),
    },
    {
      title: "The lead page",
      lines: [
        "Open a lead to see its FMCSA profile: MC and DOT numbers, address and authority status.",
        "The timeline shows every call, email, text and note. Change the stage and write notes on the same page.",
        "Broker phone numbers and emails are hidden on purpose — you call, text and email from inside the app.",
      ],
      mock: <LeadPageMock />,
    },
    {
      title: "Making a call",
      lines: [
        "Click Call and allow microphone access when the browser asks. You need a headset.",
        `Calls are allowed ${hour12(CALL_START_HOUR)}–${hour12(CALL_END_HOUR)} in the broker's local time, Monday to Friday. The lead page shows broker time next to your local time.`,
        `After ${MAX_UNANSWERED_TRIES} unanswered tries a broker gets a ${COOLDOWN_MINUTES / 60}-hour cooldown. You can make up to ${hourlyCallLimit} calls per hour.`,
        "Outside allowed hours, use “Request after-hours call” with a note. Admin approves each request.",
      ],
      mock: <CallMock limit={hourlyCallLimit} agentTz={agentTz} />,
      extra: <MicTest />,
    },
    {
      title: "The call script",
      lines: [
        <>Open every call with: “Hi, this is <b>{agentFirstName}</b> with Loadlinkers.”</>,
        <>At the start of every call, say: “<b>This call may be recorded</b>.”</>,
        "Every call is recorded and transcribed, and admin can review them.",
      ],
      mock: <ScriptMock name={agentFirstName} />,
    },
    {
      title: "After every call",
      lines: [
        "Pick a disposition — what happened on the call (callback, voicemail, not interested…).",
        "Update the lead's stage if it changed.",
        "Write a short note so you (and admin) know what to do next time.",
      ],
      mock: <AfterCallMock />,
    },
    {
      title: "Your account",
      lines: [
        "In My Account you can change your password: enter your current password, then the new one.",
        "Your login ID always stays the same.",
        "Forgot your password? Click “Contact Support” on the login screen and admin will reset it.",
      ],
      mock: <AccountMock />,
    },
    {
      title: "You're ready",
      lines: ["Quick recap before you start:"],
      mock: null,
      extra: (
        <ul className="space-y-2">
          {[
            "Read the Company page so you know what we sell",
            "Work only your assigned leads; move each lead to the right stage",
            `Call ${hour12(CALL_START_HOUR)}–${hour12(CALL_END_HOUR)} broker time; request approval for anything outside it`,
            `Respect the ${COOLDOWN_MINUTES / 60}-hour cooldown and the ${hourlyCallLimit} calls/hour cap`,
            `Open with “Hi, this is ${agentFirstName} with Loadlinkers” and say the call may be recorded`,
            "After every call: disposition, stage, short note",
            "Questions? Help → Ask admin. Forgot password? Contact Support on the login screen",
          ].map((t) => (
            <li key={t} className="flex items-start gap-2 text-sm">
              <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-green-600 text-white"><Check className="size-3" /></span>
              {t}
            </li>
          ))}
        </ul>
      ),
    },
  ]

  const last = step === TOUR_STEP_COUNT - 1
  const current = steps[step]

  function go(to: number) {
    const next = Math.max(0, Math.min(TOUR_STEP_COUNT - 1, to))
    setStep(next)
    // Replay never changes the saved progress.
    if (!replay) saveOnboardingStep(next).catch(() => {})
  }

  function finish() {
    if (replay) router.push("/leads")
    else startFinish(() => completeOnboarding())
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <header className="shrink-0 border-b">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <div className="size-6 rounded-md bg-foreground" aria-hidden />
          <span className="text-sm font-semibold tracking-tight">Getting started</span>
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            Step {step + 1} of {TOUR_STEP_COUNT}
          </span>
          {replay && (
            <Button variant="ghost" size="icon-sm" nativeButton={false} render={<Link href="/leads" aria-label="Close walkthrough" />}>
              <X className="size-4" />
            </Button>
          )}
        </div>
        <div className="h-1 bg-muted" role="progressbar" aria-valuemin={1} aria-valuemax={TOUR_STEP_COUNT} aria-valuenow={step + 1}>
          <div className="h-full bg-primary transition-[width] duration-300 ease-[var(--ease-out)]" style={{ width: `${((step + 1) / TOUR_STEP_COUNT) * 100}%` }} />
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div key={step} className="mx-auto grid max-w-5xl gap-8 px-4 py-8 sm:py-12 md:grid-cols-2 md:items-center animate-in-fade">
          <div className="space-y-4">
            <h1 className="text-2xl font-semibold tracking-tight">{current.title}</h1>
            <div className="space-y-2.5 text-[15px] leading-relaxed text-muted-foreground">
              {current.lines.map((l, i) => (
                <p key={i}>{l}</p>
              ))}
            </div>
            {current.extra}
          </div>
          {current.mock && <div>{current.mock}</div>}
        </div>
      </main>

      <footer className="shrink-0 border-t">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-3">
          <Button variant="ghost" onClick={() => go(step - 1)} disabled={step === 0 || finishing}>
            <ArrowLeft className="size-4" />
            Back
          </Button>
          <div className="ml-auto">
            {last ? (
              <Button onClick={finish} disabled={finishing}>
                {finishing ? "Opening…" : "Start working my leads"}
                <ArrowRight className="size-4" />
              </Button>
            ) : (
              <Button onClick={() => go(step + 1)}>
                Next
                <ArrowRight className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </footer>
    </div>
  )
}
