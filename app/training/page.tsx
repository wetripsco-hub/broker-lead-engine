import type { Metadata } from "next"
import { FileText } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export const metadata: Metadata = {
  title: "New agent training · Broker Lead Engine",
  description: "How to make a sales call: a short training video for new agents.",
}

const BEFORE_FIRST_CALL = [
  "Sign in with the email and password from your admin, then change your password in My Account.",
  "Open your lead list. Every lead assigned to you is yours only.",
  "Check the broker's local time before you call.",
  "Use a headset and allow your microphone the first time.",
  "After every call, choose a disposition and save it.",
]

const RULES = [
  "Call 8 AM to 6 PM broker time, Monday to Friday.",
  "Up to 40 calls per hour.",
  "Say “This call may be recorded for quality.”",
  "Text only after the broker agrees.",
  "$69/month, 7-day free trial.",
]

function List({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2.5 text-sm">
      {items.map((t) => (
        <li key={t} className="flex gap-2.5">
          <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
          <span className="leading-relaxed">{t}</span>
        </li>
      ))}
    </ul>
  )
}

export default function TrainingPage() {
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:py-12">
        <p className="text-xs font-bold tracking-[0.2em] text-foreground">LOADLINKERS</p>

        <header className="mt-8 sm:mt-10">
          <p className="text-xs font-medium uppercase tracking-wide text-primary">
            Broker Lead Engine · New agent training
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">How to make a sales call</h1>
          <p className="mt-3 max-w-2xl text-sm text-muted-foreground sm:text-base">
            Watch this once before your first shift. It walks you through signing in, finding your leads, the call
            script, texting rules and logging every call.
          </p>
        </header>

        <div className="mt-6 aspect-video w-full overflow-hidden rounded-xl border bg-black shadow-sm">
          <video
            controls
            playsInline
            preload="metadata"
            poster="/training/poster.jpg"
            src="/training/training.mp4"
            className="size-full"
          >
            Your browser can&apos;t play this video.{" "}
            <a href="/training/training.mp4" className="underline">
              Download it instead
            </a>
            .
          </video>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Before your first call</CardTitle>
            </CardHeader>
            <CardContent>
              <List items={BEFORE_FIRST_CALL} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Rules to remember</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <List items={RULES} />
              <a
                href="/training/call-script.pdf"
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({ className: "w-full sm:w-auto" })}
              >
                <FileText className="size-4" />
                Open the call script (PDF)
              </a>
            </CardContent>
          </Card>
        </div>

        <footer className="mt-10 border-t pt-6 text-center text-sm text-muted-foreground">
          Need help? In the portal, open Help, then Ask admin.
        </footer>
      </div>
    </main>
  )
}
