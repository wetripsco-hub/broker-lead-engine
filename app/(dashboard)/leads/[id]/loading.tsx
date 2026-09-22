import { Skeleton } from "@/components/ui/skeleton"

export default function LeadDetailLoading() {
  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <Skeleton className="h-4 w-24 mb-3" />
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-7 w-56" />
            <Skeleton className="h-4 w-28" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-8 w-24" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_300px] gap-6">
        <div className="space-y-6">
          <div className="rounded-lg border bg-card p-4 space-y-2.5">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-4 w-48" />)}
          </div>
          <div className="rounded-lg border bg-card divide-y">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-start gap-3 px-4 py-3">
                <Skeleton className="size-7 rounded-full shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-40" />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-lg border bg-card p-4 space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-32" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
