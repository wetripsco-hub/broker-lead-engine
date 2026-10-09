"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Pencil, Trash2, TriangleAlert } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { deleteLeadPermanently, updateLeadDetails } from "@/app/(dashboard)/leads/admin-actions"

export interface EditableBroker {
  company_name: string | null
  contact_name: string | null
  email: string | null
  phone: string | null
  address_line1: string | null
  city: string | null
  state: string | null
  zip: string | null
  mc_number: string | null
  dot_number: string | null
}

interface Props {
  leadId: string
  broker: EditableBroker
  /** Calls, emails, SMS and AI calls that would be deleted with the lead. */
  eventCount: number
}

/** Admin only. The server checks the role in the database and refuses anyone else. */
export function LeadAdminActions({ leadId, broker, eventCount }: Props) {
  const [mode, setMode] = useState<"edit" | "delete" | null>(null)
  return (
    <>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setMode("edit")}>
        <Pencil className="size-3.5" />
        Edit
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 text-destructive hover:text-destructive"
        onClick={() => setMode("delete")}
      >
        <Trash2 className="size-3.5" />
        Delete
      </Button>
      {mode === "edit" && <EditDialog leadId={leadId} broker={broker} onClose={() => setMode(null)} />}
      {mode === "delete" && (
        <DeleteDialog leadId={leadId} broker={broker} eventCount={eventCount} onClose={() => setMode(null)} />
      )}
    </>
  )
}

function Shell({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4 animate-in-fade"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full ${wide ? "max-w-xl" : "max-w-md"} rounded-xl border bg-card p-5 text-left shadow-xl animate-in-rise`}
      >
        <h2 className="mb-4 text-sm font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  )
}

const FIELDS: Array<{ key: keyof EditableBroker; label: string; span?: 2; placeholder?: string }> = [
  { key: "company_name", label: "Company name", span: 2 },
  { key: "contact_name", label: "Contact name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone", placeholder: "(214) 370-8737 or +923001234567" },
  { key: "mc_number", label: "MC number" },
  { key: "dot_number", label: "DOT number" },
  { key: "address_line1", label: "Address", span: 2 },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "zip", label: "ZIP" },
]

function EditDialog({ leadId, broker, onClose }: { leadId: string; broker: EditableBroker; onClose: () => void }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [form, setForm] = useState<Record<keyof EditableBroker, string>>(() => {
    const init = {} as Record<keyof EditableBroker, string>
    for (const f of FIELDS) init[f.key] = broker[f.key] ?? ""
    return init
  })
  const [error, setError] = useState<string | null>(null)
  const dirty = FIELDS.some((f) => form[f.key] !== (broker[f.key] ?? ""))

  function save() {
    setError(null)
    startTransition(async () => {
      const res = await updateLeadDetails(leadId, form)
      if (!res.ok) {
        setError(res.error)
        toast.error(res.error)
        return
      }
      toast.success(res.message)
      router.refresh()
      onClose()
    })
  }

  return (
    <Shell title="Edit lead" onClose={() => !pending && onClose()} wide>
      <div className="grid grid-cols-2 gap-3">
        {FIELDS.map((f) => (
          <div key={f.key} className={f.span === 2 ? "col-span-2" : ""}>
            <label htmlFor={`lead-${f.key}`} className="mb-1 block text-xs text-muted-foreground">
              {f.label}
            </label>
            <input
              id={`lead-${f.key}`}
              value={form[f.key]}
              placeholder={f.placeholder}
              onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
              className="h-8 w-full rounded-md border border-input bg-transparent px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Stage, notes and assigned agent are changed on the page itself. The phone number is checked and stored in
        international format.
      </p>
      {error && <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button size="sm" onClick={save} disabled={pending || !dirty}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </Shell>
  )
}

function DeleteDialog({ leadId, broker, eventCount, onClose }: Props & { onClose: () => void }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [typed, setTyped] = useState("")
  const [error, setError] = useState<string | null>(null)

  function remove() {
    setError(null)
    startTransition(async () => {
      const res = await deleteLeadPermanently(leadId, typed)
      if (!res.ok) {
        setError(res.error)
        toast.error(res.error)
        return
      }
      toast.success(res.message)
      router.push("/leads")
      router.refresh()
    })
  }

  return (
    <Shell title="Delete this lead permanently?" onClose={() => !pending && onClose()}>
      <div className="flex gap-3">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
        <div className="space-y-2 text-sm">
          <p>
            <span className="font-medium">{broker.company_name ?? "This lead"}</span>
            {broker.mc_number ? <span className="font-mono text-xs text-muted-foreground"> · MC-{broker.mc_number}</span> : null}
          </p>
          <p className="text-muted-foreground">
            This also deletes its <span className="font-medium text-foreground">{eventCount}</span> activity record
            {eventCount === 1 ? "" : "s"} (calls, emails, SMS, AI calls, transcripts and recordings links). It can&apos;t be
            undone. The deletion is written to the audit log.
          </p>
        </div>
      </div>
      <label htmlFor="delete-confirm" className="mt-4 block text-xs text-muted-foreground">
        Type <span className="font-mono font-semibold text-foreground">DELETE</span> to confirm
      </label>
      <input
        id="delete-confirm"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        autoComplete="off"
        autoFocus
        className="mt-1 h-8 w-full rounded-md border border-input bg-transparent px-2.5 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
      />
      {error && <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button
          size="sm"
          className="gap-1.5 bg-destructive text-white hover:bg-destructive/90"
          onClick={remove}
          disabled={pending || typed !== "DELETE"}
        >
          <Trash2 className="size-3.5" />
          {pending ? "Deleting…" : "Delete lead"}
        </Button>
      </div>
    </Shell>
  )
}
