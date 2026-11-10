import type { Metadata } from "next"
import { BookOpen, FileText } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { CopyLink } from "./copy-link"

export const metadata: Metadata = {
  title: "Agent training hub · Broker Lead Engine",
  description: "Everything a new Loadlinkers agent needs before the first call: videos, playbook, call script and rules.",
}

const BROKER_LINK = "https://loadlinkers.co"

const RULES = [
  "Call 8 AM to 6 PM broker time, Monday to Friday.",
  "Up to 40 calls per hour. 2 unanswered tries = 1-hour cooldown.",
  "Say “This call may be recorded for quality.” on every call.",
  "Text only after the broker agrees.",
  "Starter $69/month, Growth $189/month, Scale custom. 7-day free trial.",
]

function StepHeading({ step, title }: { step?: string; title: string }) {
  return (
    <h2 className="text-lg font-semibold tracking-tight sm:text-xl">
      {step && <span className="text-primary">{step} · </span>}
      {title}
    </h2>
  )
}

function Video({ src, poster }: { src: string; poster?: string }) {
  return (
    <div className="aspect-video w-full overflow-hidden rounded-xl border bg-black shadow-sm">
      <video controls playsInline preload="metadata" poster={poster} src={src} className="size-full">
        Your browser can&apos;t play this video.{" "}
        <a href={src} className="underline">
          Download it instead
        </a>
        .
      </video>
    </div>
  )
}

/** PDF shown inline on tablets and computers; phones get only the button. */
function InlinePdf({ src, title }: { src: string; title: string }) {
  return (
    <iframe
      src={src}
      title={title}
      className="mt-5 hidden md:block"
      style={{ width: "100%", height: "80vh", border: "1px solid #DDE3EE", borderRadius: 12 }}
    />
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
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Agent training hub</h1>
          <p className="mt-3 max-w-2xl text-sm text-muted-foreground sm:text-base">
            Everything you need before your first call. Watch the videos, read the playbook, then start calling.
          </p>
        </header>

        <div className="mt-10 space-y-12">
          <section className="space-y-4">
            <StepHeading step="Step 1" title="How to use the portal and make calls" />
            <Video src="/training/training.mp4" poster="/training/poster.jpg" />
          </section>

          <section className="space-y-4">
            <StepHeading step="Step 2" title="Know the product" />
            <Video src="/sales/Loadlinkers-Product-Walkthrough.mp4" />
            <p className="text-sm text-muted-foreground">
              This is the same video brokers see. Know it well before you call.
            </p>
          </section>

          <section className="space-y-4">
            <StepHeading step="Step 3" title="Read the playbook" />
            <Card>
              <CardContent>
                <p className="text-sm leading-relaxed">
                  Agent playbook (PDF, 7 pages): your goal on every call, the product and plans, calling rules, the
                  full script, objections, what to log and your first week.
                </p>
                <a
                  href="/training/agent-playbook.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonVariants({ className: "mt-4 w-full sm:w-auto" })}
                >
                  <BookOpen className="size-4" />
                  Open playbook
                </a>
                <InlinePdf src="/training/agent-playbook.pdf" title="Agent playbook" />
              </CardContent>
            </Card>
          </section>

          <section className="space-y-4">
            <StepHeading step="Step 4" title="Keep the call script handy" />
            <Card>
              <CardContent>
                <p className="text-sm leading-relaxed">
                  One-page quick reference: the opener, the yes path, objections, the Marketplace pitch and the rules.
                  Keep it open while you call.
                </p>
                <a
                  href="/training/call-script.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonVariants({ className: "mt-4 w-full sm:w-auto" })}
                >
                  <FileText className="size-4" />
                  Open call script
                </a>
                <InlinePdf src="/training/call-script.pdf" title="Call script" />
              </CardContent>
            </Card>
          </section>

          <section className="space-y-4">
            <StepHeading title="What to send brokers" />
            <Card>
              <CardContent className="space-y-3">
                <p className="text-sm">After the broker says yes on the call, send them this link:</p>
                <CopyLink url={BROKER_LINK} />
                <p className="text-xs text-muted-foreground">
                  Only send after the broker gives permission. Save the outcome first.
                </p>
              </CardContent>
            </Card>
          </section>

          <section>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Rules to remember</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2.5 text-sm">
                  {RULES.map((t) => (
                    <li key={t} className="flex gap-2.5">
                      <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                      <span className="leading-relaxed">{t}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </section>
        </div>

        <footer className="mt-12 border-t pt-6 text-center text-sm text-muted-foreground">
          Need help? In the portal, open Help, then Ask admin.
        </footer>
      </div>
    </main>
  )
}
