"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Send, Upload, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { renderTemplate } from "@/lib/recruiter/template"
import type { CsvPreview } from "@/lib/recruiter/csv"
import { batchProgress, cancelBatch, importRecruits, previewRecruitCsv, queueRecruitEmails, retryFailed, tickSendQueue } from "./actions"
import { RECRUIT_STAGES, STAGE_LABEL, type BatchProgress, type Recruit, type RecruitStage } from "./types"
import type { RecruiterProps } from "./recruiter-client"
import { StageBadge } from "./stage-badge"

export function RecruitsPanel({ recruits, templates, smtpReady, pace, activeBatchId, onGoToTemplates }: RecruiterProps & { onGoToTemplates: () => void }) {
  const [stage, setStage] = useState<RecruitStage | "all">("all")
  const [noReply, setNoReply] = useState(false)
  const [q, setQ] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [importOpen, setImportOpen] = useState(false)
  const [sendOpen, setSendOpen] = useState(false)
  const [batchId, setBatchId] = useState<string | null>(activeBatchId)

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return recruits.filter(
      (r) =>
        (stage === "all" || r.stage === stage) &&
        (!noReply || !r.last_reply_at) &&
        (!s || r.name.toLowerCase().includes(s) || r.email.includes(s)),
    )
  }, [recruits, stage, noReply, q])

  const allSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.id))
  function toggleAll() {
    const next = new Set(selected)
    if (allSelected) filtered.forEach((r) => next.delete(r.id))
    else filtered.forEach((r) => next.add(r.id))
    setSelected(next)
  }
  function toggle(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }
  const chosen = recruits.filter((r) => selected.has(r.id))

  return (
    <div className="space-y-3">
      {batchId && <SendProgress batchId={batchId} pace={pace} onClose={() => setBatchId(null)} />}

      <div className="flex flex-wrap items-center gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email" className="h-8 w-56 text-sm" />
        <select
          value={stage}
          onChange={(e) => setStage(e.target.value as RecruitStage | "all")}
          className="h-8 rounded-lg border bg-background px-2 text-sm"
          aria-label="Stage"
        >
          <option value="all">All stages</option>
          {RECRUIT_STAGES.map((s) => (
            <option key={s} value={s}>{STAGE_LABEL[s]}</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <input type="checkbox" checked={noReply} onChange={(e) => setNoReply(e.target.checked)} />
          No reply yet
        </label>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setImportOpen(true)}>
            <Upload className="size-3.5" /> Upload CSV
          </Button>
          <Button size="sm" className="gap-1.5" disabled={chosen.length === 0 || !smtpReady} onClick={() => setSendOpen(true)} title={!smtpReady ? "Set up RECRUIT_SMTP_* in Vercel first" : undefined}>
            <Send className="size-3.5" /> Send email{chosen.length ? ` (${chosen.length})` : ""}
          </Button>
        </div>
      </div>

      <div className="rounded-lg border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground border-b">
            <tr>
              <th className="w-9 px-3 py-2 text-left">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" />
              </th>
              <th className="px-2 py-2 text-left font-medium">Name</th>
              <th className="px-2 py-2 text-left font-medium">Email</th>
              <th className="px-2 py-2 text-left font-medium">Stage</th>
              <th className="px-2 py-2 text-left font-medium hidden md:table-cell">Last emailed</th>
              <th className="px-2 py-2 text-left font-medium hidden md:table-cell">Last reply</th>
              <th className="px-2 py-2 text-left font-medium hidden lg:table-cell">Source</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-10 text-center text-muted-foreground">
                  {recruits.length === 0 ? "No recruits yet. Upload a CSV with name and email columns." : "Nobody matches these filters."}
                </td>
              </tr>
            ) : (
              filtered.slice(0, 1000).map((r) => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.email}`} />
                  </td>
                  <td className="px-2 py-2">{r.name || <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-2 py-2 text-muted-foreground">{r.email}</td>
                  <td className="px-2 py-2"><StageBadge stage={r.stage} /></td>
                  <td className="px-2 py-2 text-muted-foreground hidden md:table-cell">{fmt(r.last_emailed_at)}</td>
                  <td className="px-2 py-2 text-muted-foreground hidden md:table-cell">{fmt(r.last_reply_at)}</td>
                  <td className="px-2 py-2 text-muted-foreground hidden lg:table-cell truncate max-w-40">{r.source ?? ""}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {filtered.length > 1000 && (
          <p className="px-3 py-2 text-xs text-muted-foreground border-t">
            Showing the first 1,000 of {filtered.length}. "Select all" still selects all {filtered.length}.
          </p>
        )}
      </div>

      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}
      {sendOpen && (
        <SendDialog
          recruits={chosen}
          templates={templates}
          pace={pace}
          onGoToTemplates={() => {
            setSendOpen(false)
            onGoToTemplates()
          }}
          onClose={() => setSendOpen(false)}
          onQueued={(id) => {
            setSendOpen(false)
            setSelected(new Set())
            setBatchId(id)
          }}
        />
      )}
    </div>
  )
}

function fmt(d: string | null) {
  return d ? new Date(d).toLocaleDateString([], { month: "short", day: "numeric" }) : "—"
}

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className={`bg-card border rounded-xl shadow-xl w-full ${wide ? "max-w-2xl" : "max-w-md"} max-h-[90vh] flex flex-col`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b">
          <h2 className="font-semibold text-sm">{title}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}

function ImportDialog({ onClose }: { onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<CsvPreview | null>(null)
  const [busy, start] = useTransition()
  const router = useRouter()

  function read(f: File) {
    setFile(f)
    setPreview(null)
    start(async () => {
      const text = await f.text()
      const r = await previewRecruitCsv(text)
      if ("valid" in r) setPreview(r)
      else toast.error(r.error)
    })
  }

  function doImport() {
    if (!preview || !file) return
    start(async () => {
      const r = await importRecruits(preview.valid, file.name)
      if (r.error) toast.error(r.error)
      else {
        toast.success(`${r.imported} recruits imported`)
        router.refresh()
        onClose()
      }
    })
  }

  return (
    <Modal title="Upload recruits (CSV)" onClose={onClose} wide>
      <div className="space-y-4 text-sm">
        <p className="text-muted-foreground">The first row must be headers with <b>name</b> and <b>email</b> (any capitalisation).</p>
        <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && read(e.target.files[0])} />
        {busy && !preview && <p className="text-muted-foreground">Reading…</p>}
        {preview?.error && <p className="text-destructive">{preview.error}</p>}
        {preview && !preview.error && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Stat label="Will import" value={preview.valid.length} tone="good" />
              <Stat label="Invalid email" value={preview.invalid.length} tone={preview.invalid.length ? "bad" : undefined} />
              <Stat label="Duplicate in file" value={preview.duplicateInFile.length} />
              <Stat label="Already added" value={preview.alreadyExists.length} />
            </div>
            <PreviewList title="Will import" rows={preview.valid} />
            <PreviewList title="Invalid (skipped)" rows={preview.invalid.map((r) => ({ ...r, note: r.reason }))} />
            <PreviewList title="Duplicates in this file (skipped)" rows={preview.duplicateInFile} />
            <PreviewList title="Already in Recruiter (skipped)" rows={preview.alreadyExists} />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button size="sm" disabled={busy || preview.valid.length === 0} onClick={doImport}>
                {busy ? "Importing…" : `Import ${preview.valid.length}`}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-md border px-2.5 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${tone === "good" ? "text-emerald-600" : tone === "bad" ? "text-destructive" : ""}`}>{value}</p>
    </div>
  )
}

function PreviewList({ title, rows }: { title: string; rows: Array<{ line: number; name: string; email: string; note?: string }> }) {
  if (rows.length === 0) return null
  return (
    <details className="rounded-md border" open={title === "Will import" && rows.length <= 10}>
      <summary className="cursor-pointer px-3 py-1.5 text-xs font-medium">{title} ({rows.length})</summary>
      <ul className="max-h-40 overflow-y-auto px-3 pb-2 text-xs text-muted-foreground space-y-0.5">
        {rows.slice(0, 300).map((r) => (
          <li key={`${r.line}-${r.email}`}>
            Row {r.line}: {r.name || "(no name)"} · {r.email || "(empty)"}{r.note ? ` · ${r.note}` : ""}
          </li>
        ))}
      </ul>
    </details>
  )
}

function SendDialog({
  recruits,
  templates,
  pace,
  onClose,
  onQueued,
  onGoToTemplates,
}: {
  recruits: Recruit[]
  templates: RecruiterProps["templates"]
  pace: RecruiterProps["pace"]
  onClose: () => void
  onQueued: (batchId: string) => void
  onGoToTemplates: () => void
}) {
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "")
  const [busy, start] = useTransition()
  const tpl = templates.find((t) => t.id === templateId)
  const first = recruits[0]
  const minutes = Math.ceil((recruits.length * (pace.minSeconds + pace.maxSeconds)) / 2 / 60)
  const hours = recruits.length > pace.maxPerHour ? Math.ceil(recruits.length / pace.maxPerHour) : 0

  function send() {
    start(async () => {
      const r = await queueRecruitEmails(recruits.map((x) => x.id), templateId)
      if (r.error || !r.batchId) toast.error(r.error ?? "Could not queue")
      else {
        toast.success(`${r.queued} emails queued${r.skipped ? ` (${r.skipped} already waiting)` : ""}`)
        onQueued(r.batchId)
      }
    })
  }

  return (
    <Modal title={`Send to ${recruits.length} ${recruits.length === 1 ? "recruit" : "recruits"}`} onClose={onClose} wide>
      {templates.length === 0 ? (
        <div className="text-sm space-y-3">
          <p>Create a recruiter template first.</p>
          <Button size="sm" onClick={onGoToTemplates}>Go to Templates</Button>
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="h-9 w-full rounded-lg border bg-background px-2" aria-label="Template">
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          {tpl && first && (
            <div className="rounded-md border bg-muted/30 p-4">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">First email: to {first.email}</p>
              <p className="font-medium">{renderTemplate(tpl.subject, first)}</p>
              <div className="mt-2 whitespace-pre-wrap leading-relaxed">{renderTemplate(tpl.body, first)}</div>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Sent from info@loadlinkers.co, one every {pace.minSeconds}–{pace.maxSeconds} seconds, at most {pace.maxPerHour} an hour.
            About {hours ? `${hours} hours` : `${minutes} min`} in total. Keep this page open, or the 1-minute scheduler keeps it going.
          </p>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={send} disabled={busy || !tpl} className="gap-1.5">
              <Send className="size-3.5" /> {busy ? "Queuing…" : `Confirm & send ${recruits.length}`}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

function SendProgress({ batchId, pace, onClose }: { batchId: string; pace: RecruiterProps["pace"]; onClose: () => void }) {
  const [p, setP] = useState<BatchProgress | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const router = useRouter()
  const running = useRef(false)
  const pending = p ? p.queued + p.sending : 1

  useEffect(() => {
    let stop = false
    batchProgress(batchId).then((r) => !stop && ("total" in r ? setP(r) : setErr(r.error)))
    const t = setInterval(async () => {
      if (running.current) return
      running.current = true
      const r = await tickSendQueue(batchId)
      running.current = false
      if (stop) return
      if ("total" in r) {
        setP((old) => {
          if (old && r.sent > old.sent) router.refresh()
          return r
        })
        setErr(null)
      } else setErr(r.error)
    }, 5000)
    return () => {
      stop = true
      clearInterval(t)
    }
  }, [batchId, router])

  if (!p) return <div className="rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground">Loading send progress…</div>
  const done = p.sent + p.failed + p.cancelled
  const pct = p.total ? Math.round((done / p.total) * 100) : 0

  return (
    <div className="rounded-lg border bg-card px-4 py-3 space-y-2 text-sm">
      <div className="flex items-center gap-3">
        <p className="font-medium">
          {pending > 0 ? "Sending…" : "Batch finished"} {p.sent} of {p.total} sent
          {p.failed ? <span className="text-destructive"> · {p.failed} failed</span> : null}
          {p.cancelled ? <span className="text-muted-foreground"> · {p.cancelled} cancelled</span> : null}
        </p>
        <div className="ml-auto flex gap-2">
          {pending > 0 && (
            <Button size="xs" variant="outline" onClick={async () => { await cancelBatch(batchId); setP(await batchProgress(batchId) as BatchProgress) }}>
              Stop
            </Button>
          )}
          {p.failed > 0 && pending === 0 && (
            <Button size="xs" variant="outline" onClick={async () => { await retryFailed(batchId); setP(await batchProgress(batchId) as BatchProgress) }}>
              Retry failed
            </Button>
          )}
          {pending === 0 && (
            <Button size="xs" variant="ghost" onClick={onClose}>Close</Button>
          )}
        </div>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className="h-full bg-primary transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }} />
      </div>
      {pending > 0 && <p className="text-xs text-muted-foreground">Next email in up to {pace.maxSeconds} s. Max {pace.maxPerHour} an hour.</p>}
      {err && <p className="text-xs text-destructive">{err}</p>}
      {p.failures.length > 0 && (
        <ul className="text-xs text-destructive space-y-0.5 max-h-28 overflow-y-auto">
          {p.failures.map((f, i) => (
            <li key={i}>{f.email}: {f.error}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
