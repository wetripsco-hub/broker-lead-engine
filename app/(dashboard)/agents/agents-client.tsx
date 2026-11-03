"use client"

import { useState, useTransition } from "react"
import { UserPlus, KeyRound, X, Users, Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { toast } from "sonner"
import { createAgent, toggleAgentActive, resetAgentPassword, updateAgent, deleteAgent, setWelcomeTour } from "./actions"

interface Agent {
  id: string
  name: string
  email: string | null
  active: boolean
  created_at: string
  /** null = the welcome tour opens on their next sign-in. */
  onboarding_completed_at: string | null
}

export function AgentsClient({
  agents,
  leadCounts,
}: {
  agents: Agent[]
  leadCounts: Record<string, number>
}) {
  const [addOpen, setAddOpen] = useState(false)
  const [resetFor, setResetFor] = useState<Agent | null>(null)
  const [editFor, setEditFor] = useState<Agent | null>(null)
  const [deleteFor, setDeleteFor] = useState<Agent | null>(null)
  const [isPending, startTransition] = useTransition()
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [tourId, setTourId] = useState<string | null>(null)

  function handleTour(agent: Agent, show: boolean) {
    setTourId(agent.id)
    startTransition(async () => {
      const { error } = await setWelcomeTour(agent.id, show)
      if (error) toast.error(error)
      else toast.success(show ? `${agent.name} will see the welcome tour on next sign-in` : `Welcome tour turned off for ${agent.name}`)
      setTourId(null)
    })
  }

  function handleToggle(agent: Agent) {
    setTogglingId(agent.id)
    startTransition(async () => {
      const { error } = await toggleAgentActive(agent.id, !agent.active)
      if (error) toast.error(error)
      else toast.success(agent.active ? `${agent.name} disabled` : `${agent.name} enabled`)
      setTogglingId(null)
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
          <p className="text-sm text-muted-foreground mt-1">{agents.length} total</p>
        </div>
        <Button size="sm" className="gap-2" onClick={() => setAddOpen(true)}>
          <UserPlus className="size-3.5" />
          Add Agent
        </Button>
      </div>

      <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
        {agents.length === 0 ? (
          <div className="py-14 flex flex-col items-center gap-2.5 text-center">
            <div className="size-10 rounded-full bg-muted flex items-center justify-center">
              <Users className="size-4 text-muted-foreground/60" />
            </div>
            <p className="text-sm text-muted-foreground">No agents yet. Click "Add Agent" to create one.</p>
          </div>
        ) : (
          <div>
            <div className="grid grid-cols-[1fr_70px_70px_100px_80px_140px_64px] gap-4 px-4 py-2 border-b text-xs font-medium text-muted-foreground uppercase tracking-wide">
              <span>Name / Email</span>
              <span>Leads</span>
              <span>Status</span>
              <span title="Tick to show the welcome tour the next time this agent signs in. It unticks itself once they finish it.">Welcome tour</span>
              <span />
              <span />
              <span />
            </div>
            {agents.map((a) => (
              <div
                key={a.id}
                className="grid grid-cols-[1fr_70px_70px_100px_80px_140px_64px] gap-4 px-4 py-3 border-b last:border-0 items-center text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium truncate">{a.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{a.email ?? "—"}</p>
                </div>
                <span className="text-muted-foreground tabular-nums">{leadCounts[a.id] ?? 0}</span>
                <span
                  className={`text-xs px-1.5 py-0.5 rounded-full font-medium w-fit ${
                    a.active
                      ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {a.active ? "Active" : "Disabled"}
                </span>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer w-fit">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary cursor-pointer"
                    checked={!a.onboarding_completed_at}
                    disabled={isPending && tourId === a.id}
                    onChange={(e) => handleTour(a, e.target.checked)}
                    aria-label={`Show welcome tour to ${a.name} on next sign-in`}
                  />
                  {a.onboarding_completed_at ? "Off" : "Next login"}
                </label>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={isPending && togglingId === a.id}
                  onClick={() => handleToggle(a)}
                >
                  {isPending && togglingId === a.id ? "…" : a.active ? "Disable" : "Enable"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1.5"
                  onClick={() => setResetFor(a)}
                >
                  <KeyRound className="size-3" />
                  Reset password
                </Button>
                <div className="flex items-center justify-end gap-0.5">
                  <Button variant="ghost" size="icon-sm" aria-label={`Edit ${a.name}`} title="Edit name / email" onClick={() => setEditFor(a)}>
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${a.name}`}
                    title="Delete agent"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setDeleteFor(a)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {addOpen && <AddAgentModal onClose={() => setAddOpen(false)} />}
      {resetFor && <ResetPasswordModal agent={resetFor} onClose={() => setResetFor(null)} />}
      {editFor && <EditAgentModal agent={editFor} onClose={() => setEditFor(null)} />}
      {deleteFor && (
        <DeleteAgentModal agent={deleteFor} leadCount={leadCounts[deleteFor.id] ?? 0} onClose={() => setDeleteFor(null)} />
      )}
    </div>
  )
}

function AddAgentModal({ onClose }: { onClose: () => void }) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(formData: FormData) {
    setError(null)
    startTransition(async () => {
      const result = await createAgent(formData)
      if (result.error) setError(result.error)
      else {
        toast.success("Agent created")
        onClose()
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-card border rounded-xl shadow-xl w-full max-w-sm flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="font-semibold text-sm">Add agent</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
        <form action={handleSubmit} className="px-5 py-4 space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground" htmlFor="agent-name">Name</label>
            <Input id="agent-name" name="name" required className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground" htmlFor="agent-email">Email</label>
            <Input id="agent-email" name="email" type="email" required className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground" htmlFor="agent-password">Password</label>
            <Input id="agent-password" name="password" type="password" minLength={8} required className="h-9 text-sm" />
            <p className="text-[11px] text-muted-foreground">At least 8 characters.</p>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending ? "Creating…" : "Create agent"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ResetPasswordModal({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const [password, setPassword] = useState("")
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleSubmit() {
    setError(null)
    startTransition(async () => {
      const result = await resetAgentPassword(agent.id, password)
      if (result.error) setError(result.error)
      else {
        toast.success(`Password reset for ${agent.name}`)
        onClose()
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-card border rounded-xl shadow-xl w-full max-w-sm flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="font-semibold text-sm">Reset password — {agent.name}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground" htmlFor="new-password">New password</label>
            <Input
              id="new-password"
              type="password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-9 text-sm"
            />
            <p className="text-[11px] text-muted-foreground">At least 8 characters. Share it with the agent directly.</p>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={handleSubmit} disabled={password.length < 8 || isPending}>
              {isPending ? "Saving…" : "Reset password"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function EditAgentModal({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const [name, setName] = useState(agent.name)
  const [email, setEmail] = useState(agent.email ?? "")
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const emailChanged = email.trim().toLowerCase() !== (agent.email ?? "").toLowerCase()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await updateAgent(agent.id, name, email)
      if (result.error) setError(result.error)
      else {
        toast.success(`${name.trim()} updated`)
        onClose()
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-card border rounded-xl shadow-xl w-full max-w-sm flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="font-semibold text-sm">Edit agent</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground" htmlFor="edit-agent-name">Name</label>
            <Input id="edit-agent-name" value={name} onChange={(e) => setName(e.target.value)} required className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground" htmlFor="edit-agent-email">Email (login ID)</label>
            <Input id="edit-agent-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="h-9 text-sm" />
            {emailChanged && (
              <p className="text-[11px] text-amber-700 dark:text-amber-400">
                The agent will sign in with the new email from now on. Their password stays the same.
              </p>
            )}
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button type="submit" size="sm" disabled={isPending || !name.trim() || !email.trim()}>
              {isPending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

function DeleteAgentModal({ agent, leadCount, onClose }: { agent: Agent; leadCount: number; onClose: () => void }) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleDelete() {
    setError(null)
    startTransition(async () => {
      const result = await deleteAgent(agent.id)
      if (result.error) setError(result.error)
      else {
        toast.success(`${agent.name} deleted`)
        onClose()
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-card border rounded-xl shadow-xl w-full max-w-sm flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="font-semibold text-sm">Delete {agent.name}?</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3 text-sm">
          <ul className="list-disc pl-4 space-y-1 text-muted-foreground">
            <li>{agent.email ?? "This agent"} can no longer sign in.</li>
            <li>
              {leadCount > 0
                ? `Their ${leadCount} lead${leadCount === 1 ? "" : "s"} become unassigned — reassign them from Leads.`
                : "They have no assigned leads."}
            </li>
            <li>Past calls, recordings, emails and texts are kept.</li>
          </ul>
          <p className="text-xs text-muted-foreground">This can&apos;t be undone. To pause an agent instead, use Disable.</p>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={handleDelete} disabled={isPending}>
              {isPending ? "Deleting…" : "Delete agent"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
