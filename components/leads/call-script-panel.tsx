"use client"

import { useMemo, useState } from "react"
import { ChevronLeft, ChevronRight, Copy, RotateCcw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { CALL_SCRIPT, CALLER_NOTES, GUIDED_ORDER, SCRIPT_GOALS, type ScriptItem, type ScriptLine } from "@/lib/call-script/script"
import { agentNames, fillSegments, fillText, missingPlaceholders, type ScriptVars } from "@/lib/call-script/fill"
import { contactFirstNameOrNull } from "@/lib/voice-agents/names"

interface CallScriptPanelProps {
  /** brokers.contact_name of this lead. */
  contactName: string | null
  /** Logged-in user's agent name. */
  agentName: string | null
  /** Callback number set by an admin in Settings, already formatted. */
  callbackPhone: string | null
  /** "dialer" = inside the call overlay (scrolls on its own); "page" = collapsible card on the lead page. */
  variant: "dialer" | "page"
}

const SECTION_LABEL: Record<string, string> = {
  opener: "Opener",
  yes: "Yes path",
  no: "Objections",
  marketplace: "Marketplace",
  voicemail: "Voicemail",
}

function Filled({ text, vars }: { text: string; vars: ScriptVars }) {
  return (
    <>
      {fillSegments(text, vars).map((s, i) =>
        s.missing ? (
          <mark
            key={i}
            className="rounded bg-amber-200 px-1 font-medium text-amber-950 dark:bg-amber-500/30 dark:text-amber-200"
            title={`Not known yet: fill in ${s.text}`}
          >
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  )
}

function Line({ line, vars, big }: { line: ScriptLine; vars: ScriptVars; big?: boolean }) {
  if (line.kind === "them") {
    return (
      <p className="text-xs italic text-muted-foreground">
        <span className="font-medium not-italic">They say: </span>
        &ldquo;{line.text}&rdquo;
      </p>
    )
  }
  if (line.kind === "note") {
    return <p className="text-xs italic text-amber-700 dark:text-amber-400">Note: {line.text}</p>
  }
  if (line.kind === "goto") {
    return <p className="text-xs font-medium text-blue-700 dark:text-blue-400">→ {line.text}</p>
  }
  return (
    <p className={`whitespace-pre-wrap leading-snug ${big ? "text-base font-medium" : "text-sm"}`}>
      &ldquo;<Filled text={line.text} vars={vars} />&rdquo;
    </p>
  )
}

async function copyItem(item: ScriptItem, vars: ScriptVars) {
  const body = fillText(item.lines.map((l) => l.text).join("\n\n"), vars)
  const text = item.copy?.subject ? `Subject: ${item.copy.subject}\n\n${body}` : body
  const left = missingPlaceholders(item.lines.map((l) => l.text).join("\n"), vars)
  try {
    await navigator.clipboard.writeText(text)
    toast.success(left.length ? `Copied. Still to fill in: ${left.map((x) => `[${x}]`).join(" ")}` : "Copied")
  } catch {
    toast.error("Couldn't copy. Select the text and copy it by hand.")
  }
}

export function CallScriptPanel({ contactName, agentName, callbackPhone, variant }: CallScriptPanelProps) {
  const [tab, setTab] = useState<"guided" | "full">("guided")
  const [sectionId, setSectionId] = useState<string>("opener")
  const [itemId, setItemId] = useState<string | null>(null)
  const [step, setStep] = useState(0)
  const [day, setDay] = useState("")
  const [time, setTime] = useState("")
  const [marketplaceFirst, setMarketplaceFirst] = useState(false)

  const vars: ScriptVars = useMemo(() => {
    const a = agentNames(agentName)
    return {
      name: contactFirstNameOrNull(contactName),
      firstName: a.firstName,
      fullName: a.fullName,
      phone: callbackPhone,
      day,
      time,
    }
  }, [contactName, agentName, callbackPhone, day, time])

  const section = CALL_SCRIPT.find((s) => s.id === (sectionId === "opener" && marketplaceFirst ? "marketplace-first" : sectionId))!
  const item: ScriptItem = section.items.find((i) => i.id === itemId) ?? section.items[0]
  const lastStep = item.lines.length - 1
  const cur = Math.min(step, lastStep)

  function pickSection(id: string) {
    setSectionId(id)
    setItemId(null)
    setStep(0)
  }

  function pickItem(id: string) {
    setItemId(id)
    setStep(0)
  }

  const body = (
    <div className="space-y-3">
      <p className="rounded-md bg-muted/50 px-2.5 py-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{SCRIPT_GOALS.main}</span> {SCRIPT_GOALS.backup}
        <br />
        {SCRIPT_GOALS.rule}
      </p>

      {/* Values typed during the call */}
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Day
          <input
            value={day}
            onChange={(e) => setDay(e.target.value)}
            placeholder="e.g. Thursday"
            className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm font-normal normal-case tracking-normal outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <label className="space-y-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Time
          <input
            value={time}
            onChange={(e) => setTime(e.target.value)}
            placeholder="e.g. 2:30 PM"
            className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm font-normal normal-case tracking-normal outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
      </div>

      <div className="flex gap-1 rounded-lg bg-muted p-0.5 text-xs font-medium">
        {(["guided", "full"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 rounded-md px-2 py-1.5 transition-colors ${
              tab === t ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "guided" ? "Step by step" : "Full script"}
          </button>
        ))}
      </div>

      {tab === "guided" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {GUIDED_ORDER.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => pickSection(id)}
                className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                  sectionId === id ? "border-foreground bg-foreground text-background" : "hover:bg-muted"
                }`}
              >
                {SECTION_LABEL[id]}
              </button>
            ))}
          </div>

          {sectionId === "opener" && (
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={marketplaceFirst}
                onChange={(e) => {
                  setMarketplaceFirst(e.target.checked)
                  setStep(0)
                }}
              />
              Marketplace-first opener (CRM notes show they are looking for agents)
            </label>
          )}

          {section.items.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {section.items.map((i) => (
                <button
                  key={i.id}
                  type="button"
                  onClick={() => pickItem(i.id)}
                  className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                    item.id === i.id ? "border-blue-500 bg-blue-500/10" : "hover:bg-muted"
                  }`}
                >
                  {i.title}
                </button>
              ))}
            </div>
          )}

          <ol className="space-y-2">
            {item.lines.map((line, idx) => {
              const isCurrent = idx === cur
              const done = idx < cur
              return (
                <li
                  key={idx}
                  onClick={() => setStep(idx)}
                  className={`cursor-pointer rounded-lg border px-3 py-2 transition-[opacity,background-color,border-color] duration-150 ${
                    isCurrent
                      ? "border-blue-500 bg-blue-500/10"
                      : done
                        ? "border-transparent opacity-40"
                        : "border-transparent opacity-80 hover:bg-muted/40"
                  }`}
                >
                  <Line line={line} vars={vars} big={isCurrent} />
                </li>
              )
            })}
          </ol>

          <div className="flex items-center justify-between gap-2">
            <Button variant="outline" size="sm" className="gap-1" onClick={() => setStep(Math.max(0, cur - 1))} disabled={cur === 0}>
              <ChevronLeft className="size-3.5" /> Back
            </Button>
            <span className="text-xs text-muted-foreground">
              Step {cur + 1} of {item.lines.length}
            </span>
            {cur < lastStep ? (
              <Button size="sm" className="gap-1" onClick={() => setStep(cur + 1)}>
                Next <ChevronRight className="size-3.5" />
              </Button>
            ) : (
              <Button variant="outline" size="sm" className="gap-1" onClick={() => setStep(0)}>
                <RotateCcw className="size-3.5" /> Restart
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {CALL_SCRIPT.map((sec) => (
            <details key={sec.id} className="rounded-lg border bg-background">
              <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium">{sec.title}</summary>
              <div className="space-y-3 border-t px-3 py-3">
                {sec.hint && <p className="text-xs italic text-muted-foreground">{sec.hint}</p>}
                {sec.items.map((it) => (
                  <div key={it.id} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      {sec.items.length > 1 || it.copy ? (
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{it.title}</p>
                      ) : (
                        <span />
                      )}
                      {it.copy && (
                        <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => copyItem(it, vars)}>
                          <Copy className="size-3" /> Copy
                        </Button>
                      )}
                    </div>
                    {it.copy?.subject && (
                      <p className="text-xs">
                        <span className="font-medium text-muted-foreground">Subject: </span>
                        {it.copy.subject}
                      </p>
                    )}
                    {it.lines.map((l, i) => (
                      <Line key={i} line={l} vars={vars} />
                    ))}
                  </div>
                ))}
              </div>
            </details>
          ))}
          <details className="rounded-lg border bg-background">
            <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium">Notes for callers</summary>
            <ul className="list-disc space-y-1 border-t px-7 py-3 text-xs text-muted-foreground">
              {CALLER_NOTES.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </div>
  )

  if (variant === "dialer") {
    return (
      <aside
        aria-label="Call script"
        className="flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl md:w-[460px]"
      >
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Call script</h2>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{body}</div>
      </aside>
    )
  }

  return (
    <details className="rounded-lg border bg-card">
      <summary className="cursor-pointer select-none px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Call script
      </summary>
      <div className="border-t p-4">{body}</div>
    </details>
  )
}
