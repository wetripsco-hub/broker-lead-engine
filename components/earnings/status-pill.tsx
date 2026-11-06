import { STATUS_LABEL, type EntryStatus } from "@/lib/commission"

const STATUS_STYLE: Record<EntryStatus, string> = {
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  scheduled: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  paid: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  void: "bg-muted text-muted-foreground line-through",
}

export function StatusPill({ status }: { status: EntryStatus }) {
  return <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status]}</span>
}
