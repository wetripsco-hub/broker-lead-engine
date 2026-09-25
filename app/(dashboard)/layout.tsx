import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/layout/app-sidebar"
import { PageTransition } from "@/components/layout/page-transition"
import { Toaster } from "@/components/ui/sonner"
import type { UserRole } from "@/types/database"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect("/login")

  const { data: agentData } = await supabase
    .from("agents")
    .select("id, name")
    .eq("user_id", user.id)
    .maybeSingle()

  const agent = agentData as { id: string; name: string } | null
  const role = (user.user_metadata?.role as UserRole) ?? "agent"
  const userName = agent?.name ?? user.email ?? "User"

  const { count: unreadSmsCount } = await supabase
    .from("outreach_events")
    .select("id", { count: "exact", head: true })
    .eq("channel", "sms")
    .eq("direction", "inbound")
    .is("read_at", null)

  return (
    <SidebarProvider>
      <AppSidebar
        userName={userName}
        userEmail={user.email ?? ""}
        role={role}
        agentId={agent?.id ?? null}
        unreadSmsCount={unreadSmsCount ?? 0}
      />
      <main className="flex flex-1 flex-col min-h-screen">
        <header className="flex items-center h-12 px-4 border-b shrink-0">
          <SidebarTrigger className="-ml-1" />
        </header>
        <div className="flex-1 overflow-y-auto">
          <PageTransition>{children}</PageTransition>
        </div>
      </main>
      <Toaster richColors position="top-right" />
    </SidebarProvider>
  )
}
