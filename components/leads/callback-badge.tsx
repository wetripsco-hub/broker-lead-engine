import { PhoneIncoming } from "lucide-react"

export function CallbackBadge({ status, className = "" }: { status?: string; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 ${className}`}
      title={status === "voicemail" ? "The broker called back and left a voicemail" : "The broker called back"}
    >
      <PhoneIncoming className="size-3" />
      Callback received
    </span>
  )
}
