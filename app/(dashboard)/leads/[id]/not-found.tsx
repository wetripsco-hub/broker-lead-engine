import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Search } from "lucide-react"

export default function LeadNotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center p-6">
      <div className="size-12 rounded-full bg-muted flex items-center justify-center">
        <Search className="size-5 text-muted-foreground" />
      </div>
      <div>
        <h2 className="text-lg font-semibold">Lead not found</h2>
        <p className="text-sm text-muted-foreground mt-1">
          This lead doesn&apos;t exist or you don&apos;t have access to it.
        </p>
      </div>
      <Button variant="outline" render={<Link href="/leads" />}>
        <ArrowLeft className="size-4 mr-2" />
        Back to leads
      </Button>
    </div>
  )
}
