"use client"

import { useRef, useState, useTransition } from "react"
import { FileText, Plus, Trash2, Upload } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { deleteKbItem, saveKbItem } from "./actions"

export interface KbItem {
  id: string
  title: string
  content: string
  kind: "manual" | "playbook"
  updated_at: string
}

const approxTokens = (s: string) => Math.ceil(s.length / 4)

export function KnowledgeClient({ items, isAdmin }: { items: KbItem[]; isAdmin: boolean }) {
  const manual = items.filter((i) => i.kind === "manual")
  const playbook = items.filter((i) => i.kind === "playbook")
  const [creating, setCreating] = useState(false)
  const totalTokens = manual.reduce((n, i) => n + approxTokens(i.content), 0)

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Knowledge base</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What the Sales Copilot answers from. It never says anything that isn&apos;t written here.
            {!isAdmin && " Read-only — ask an admin to change it."}
          </p>
        </div>
        {isAdmin && !creating && (
          <Button size="sm" className="gap-2 shrink-0" onClick={() => setCreating(true)}>
            <Plus className="size-3.5" />
            Add document
          </Button>
        )}
      </div>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Manual</h2>
          <span className="text-xs text-muted-foreground tabular-nums">
            ~{totalTokens.toLocaleString()} tokens
            {totalTokens > 30_000 && " · large: only relevant parts are sent per suggestion"}
          </span>
        </div>
        {creating && (
          <div className="animate-in-rise">
            <ItemEditor kind="manual" onDone={() => setCreating(false)} />
          </div>
        )}
        {manual.length === 0 && !creating ? (
          <div className="rounded-lg border bg-card py-10 text-center text-sm text-muted-foreground">
            Nothing here yet. Without a manual the copilot will say it needs to confirm everything.
          </div>
        ) : (
          manual.map((i) => <ItemCard key={i.id} item={i} isAdmin={isAdmin} />)
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Objection playbook</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Approved answers to the common objections. Empty answers are ignored.
          </p>
        </div>
        {playbook.map((i) => (
          <ItemCard key={i.id} item={i} isAdmin={isAdmin} playbook />
        ))}
      </section>
    </div>
  )
}

function ItemCard({ item, isAdmin, playbook = false }: { item: KbItem; isAdmin: boolean; playbook?: boolean }) {
  const [editing, setEditing] = useState(false)
  const [, startTransition] = useTransition()

  if (editing) {
    return (
      <div className="animate-in-fade">
        <ItemEditor item={item} kind={item.kind} lockTitle={playbook} onDone={() => setEditing(false)} />
      </div>
    )
  }

  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium">
            <FileText className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{item.title}</span>
          </p>
          {item.content.trim() ? (
            <p className="mt-1.5 line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">{item.content}</p>
          ) : (
            <p className="mt-1.5 text-xs italic text-muted-foreground/70">No answer written yet</p>
          )}
        </div>
        {isAdmin && (
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setEditing(true)}>
              Edit
            </Button>
            {!playbook && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-muted-foreground hover:text-destructive"
                aria-label={`Delete ${item.title}`}
                onClick={() => {
                  if (!confirm(`Delete "${item.title}"?`)) return
                  startTransition(async () => {
                    const { error } = await deleteKbItem(item.id)
                    if (error) toast.error(error)
                    else toast.success("Deleted")
                  })
                }}
              >
                <Trash2 className="size-3.5" />
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ItemEditor({
  item,
  kind,
  lockTitle = false,
  onDone,
}: {
  item?: KbItem
  kind: "manual" | "playbook"
  lockTitle?: boolean
  onDone: () => void
}) {
  const [title, setTitle] = useState(item?.title ?? "")
  const [content, setContent] = useState(item?.content ?? "")
  const [isPending, startTransition] = useTransition()
  const [reading, setReading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    setReading(true)
    try {
      let text: string
      if (/\.pdf$/i.test(file.name)) {
        const fd = new FormData()
        fd.set("file", file)
        const res = await fetch("/api/copilot/pdf", { method: "POST", body: fd })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? "PDF failed")
        text = json.text
      } else {
        text = await file.text()
      }
      setContent((prev) => (prev ? `${prev}\n\n${text}` : text))
      if (!title) setTitle(file.name.replace(/\.[^.]+$/, ""))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read file")
    } finally {
      setReading(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  function save() {
    startTransition(async () => {
      const { error } = await saveKbItem({ id: item?.id, title, content, kind })
      if (error) toast.error(error)
      else {
        toast.success("Saved")
        onDone()
      }
    })
  }

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <Input
        value={title}
        disabled={lockTitle}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
        placeholder="Title, e.g. Product overview"
        aria-label="Title"
      />
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={kind === "playbook" ? 4 : 12}
        placeholder={kind === "playbook" ? "The approved answer…" : "Paste text, or upload a .md / .txt / .pdf"}
        aria-label="Content"
        className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
      />
      <div className="flex items-center justify-between gap-2">
        {kind === "manual" ? (
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".md,.txt,.pdf,text/plain,text/markdown,application/pdf"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2"
              disabled={reading}
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="size-3.5" />
              {reading ? "Reading…" : "Upload file"}
            </Button>
          </>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onDone}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={isPending || !title.trim()}>
            {isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  )
}
