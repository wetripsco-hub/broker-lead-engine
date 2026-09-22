import { Skeleton } from "@/components/ui/skeleton"

export default function LeadsLoading() {
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-4 w-36" />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Skeleton className="h-8 w-64" />
        <div className="flex gap-1">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-8 w-16" />
          ))}
        </div>
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="grid grid-cols-[1fr_140px_180px_100px_32px] gap-4 px-4 py-2 border-b">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-3 w-16" />)}
          <span />
        </div>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="grid grid-cols-[1fr_140px_180px_100px_32px] gap-4 px-4 py-3 border-b last:border-0 items-center">
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-20" />
            </div>
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-7 w-28 rounded-md" />
            <Skeleton className="size-4" />
          </div>
        ))}
      </div>
    </div>
  )
}
