"use client"

import { useState } from "react"
import { Phone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DialerModal } from "./dialer-modal"

interface CallButtonProps {
  leadId: string
  agentId: string
  brokerPhone: string | null
  brokerName: string | null
}

export function CallButton({ leadId, agentId, brokerPhone, brokerName }: CallButtonProps) {
  const [open, setOpen] = useState(false)

  if (!brokerPhone) {
    return (
      <Button variant="outline" size="sm" disabled className="gap-2">
        <Phone className="size-3.5" />
        No phone
      </Button>
    )
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="gap-2"
        onClick={() => setOpen(true)}
      >
        <Phone className="size-3.5" />
        Call
      </Button>

      {open && (
        <DialerModal
          leadId={leadId}
          agentId={agentId}
          brokerPhone={brokerPhone}
          brokerName={brokerName}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
