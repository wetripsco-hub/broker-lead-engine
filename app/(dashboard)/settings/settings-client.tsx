"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { updateAgentName } from "./actions"

interface Agent {
  id: string
  name: string
  user_id: string
  commission_rate: number | null
}

interface SettingsClientProps {
  myAgent: Agent | null
  myEmail: string
  myRole: string
  allAgents: Agent[] | null // admin only
}

export function SettingsClient({ myAgent, myEmail, myRole, allAgents }: SettingsClientProps) {
  const [name, setName] = useState(myAgent?.name ?? "")
  const [isPending, startTransition] = useTransition()
  const dirty = name.trim() !== (myAgent?.name ?? "")

  function handleSave() {
    startTransition(async () => {
      const { error } = await updateAgentName(name)
      if (error) toast.error(error)
      else toast.success("Name updated")
    })
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Account and profile</p>
      </div>

      {/* Profile */}
      <section className="rounded-lg border bg-card p-5 space-y-4">
        <h2 className="text-sm font-semibold">Your profile</h2>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Email</label>
          <p className="text-sm">{myEmail}</p>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Role</label>
          <p className="text-sm capitalize">{myRole}</p>
        </div>

        {myAgent ? (
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground" htmlFor="agent-name">
              Display name
            </label>
            <div className="flex gap-2">
              <input
                id="agent-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="flex-1 h-8 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <Button
                size="sm"
                onClick={handleSave}
                disabled={!dirty || isPending}
              >
                {isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            No agent record linked to this account. Ask an admin to create one.
          </p>
        )}
      </section>

      {/* Admin: all agents */}
      {allAgents && (
        <section className="rounded-lg border bg-card">
          <div className="px-5 py-4 border-b">
            <h2 className="text-sm font-semibold">All agents</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Visible to admins only</p>
          </div>
          {allAgents.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted-foreground">No agents yet.</p>
          ) : (
            <ul className="divide-y">
              {allAgents.map((a) => (
                <li key={a.id} className="flex items-center justify-between px-5 py-3 text-sm">
                  <div>
                    <p className="font-medium">{a.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">{a.user_id}</p>
                  </div>
                  {a.commission_rate != null && (
                    <span className="text-xs text-muted-foreground">
                      {(a.commission_rate * 100).toFixed(1)}% commission
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Integrations status */}
      <section className="rounded-lg border bg-card p-5 space-y-3">
        <h2 className="text-sm font-semibold">Integrations</h2>
        {[
          { label: "Supabase", env: "NEXT_PUBLIC_SUPABASE_URL", always: true },
          { label: "Resend (email)", env: "RESEND_API_KEY" },
          { label: "Telnyx (voice + SMS)", env: "TELNYX_API_KEY" },
        ].map(({ label }) => (
          <div key={label} className="flex items-center justify-between text-sm">
            <span>{label}</span>
            <span className="text-xs text-muted-foreground">configured via .env</span>
          </div>
        ))}
      </section>
    </div>
  )
}
