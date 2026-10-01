"use client"

import { useState, useTransition } from "react"
import { UserPlus, KeyRound, X, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { toast } from "sonner"
import { createAgent, toggleAgentActive, resetAgentPassword } from "./actions"

interface Agent {
  id: string
  name: string
  email: string | null
  active: boolean
  created_at: string
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
  const [isPending, startTransition] = useTransition()
  const [togglingId, setTogglingId] = useState<string | null>(null)

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
            <div className="grid grid-cols-[1fr_120px_90px_100px_170px] gap-4 px-4 py-2 border-b text-xs font-medium text-muted-foreground uppercase tracking-wide">
              <span>Name / Email</span>
              <span>Assigned Leads</span>
              <span>Status</span>
              <span />
              <span />
            </div>
            {agents.map((a) => (
              <div
                key={a.id}
                className="grid grid-cols-[1fr_120px_90px_100px_170px] gap-4 px-4 py-3 border-b last:border-0 items-center text-sm"
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
              </div>
            ))}
          </div>
        )}
      </div>

      {addOpen && <AddAgentModal onClose={() => setAddOpen(false)} />}
      {resetFor && <ResetPasswordModal agent={resetFor} onClose={() => setResetFor(null)} />}
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
