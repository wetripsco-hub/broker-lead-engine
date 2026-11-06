"use client"

import { useState } from "react"
import { CALL_SCRIPT, CALLER_NOTES, SCRIPT_GOALS, type ScriptLine, type ScriptSection } from "@/lib/call-script/script"

const TABS = [
  { id: "quick", label: "Quick call", sections: ["short", "voicemail"] },
  { id: "normal", label: "Normal", sections: ["opener", "yes", "no", "marketplace", "marketplace-first", "text", "email"] },
  { id: "demo", label: "Demo / Detailed", sections: ["demo"] },
] as const

type TabId = (typeof TABS)[number]["id"]

function Line({ line }: { line: ScriptLine }) {
  if (line.kind === "them") {
    return (
      <p className="text-sm italic text-muted-foreground">
        <span className="font-medium not-italic">They say: </span>&ldquo;{line.text}&rdquo;
      </p>
    )
  }
  if (line.kind === "note") return <p className="text-xs italic text-amber-700 dark:text-amber-400">Note: {line.text}</p>
  if (line.kind === "goto") return <p className="text-xs font-medium text-blue-700 dark:text-blue-400">→ {line.text}</p>
  return <p className="whitespace-pre-wrap text-sm leading-relaxed">&ldquo;{line.text}&rdquo;</p>
}

function Section({ section }: { section: ScriptSection }) {
  return (
    <section className="rounded-xl border bg-card shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b bg-muted/30">
        <h2 className="text-sm font-semibold">{section.title}</h2>
        {section.hint && <p className="text-xs text-muted-foreground mt-0.5">{section.hint}</p>}
      </div>
      <div className="divide-y">
        {section.items.map((item) => (
          <div key={item.id} className="px-4 py-3 space-y-2">
            {(section.items.length > 1 || item.title !== section.title) && <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{item.title}</h3>}
            {item.copy?.subject && <p className="text-xs text-muted-foreground">Subject: {item.copy.subject}</p>}
            {item.lines.map((l, i) => (
              <Line key={i} line={l} />
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}

export function ScriptTabs() {
  const [tab, setTab] = useState<TabId>("quick")
  const current = TABS.find((t) => t.id === tab)!
  const sections = current.sections
    .map((id) => CALL_SCRIPT.find((s) => s.id === id))
    .filter((s): s is ScriptSection => !!s)

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Script" className="inline-flex rounded-lg border bg-muted/40 p-0.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-[background-color,color,box-shadow] duration-150 ease-[var(--ease-out)] ${
              tab === t.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Goals and caller notes on every tab. */}
      <div className="rounded-xl border bg-muted/30 px-4 py-3 space-y-2 text-sm">
        <p>
          <span className="font-medium">{SCRIPT_GOALS.main}</span> <span className="text-muted-foreground">{SCRIPT_GOALS.backup}</span>
        </p>
        <p className="text-xs text-muted-foreground">{SCRIPT_GOALS.rule}</p>
        <ul className="list-disc pl-4 space-y-0.5 text-xs text-muted-foreground">
          {CALLER_NOTES.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </div>

      <div role="tabpanel" aria-label={current.label} className="space-y-4" key={tab}>
        {sections.map((s) => (
          <div key={s.id} className="animate-in-fade">
            <Section section={s} />
          </div>
        ))}
      </div>
    </div>
  )
}
