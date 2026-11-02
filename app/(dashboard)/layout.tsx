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

  const role = (user.user_metadata?.role as UserRole) ?? "agent"

  // The look-ups are independent, so they are asked together.
  const [
    { data: agentData },
    { count: unreadSmsCount },
    { count: unreadEmailCount },
    { count: pendingRequestsCount },
    { count: ticketsBadgeCount },
  ] = await Promise.all([
    supabase.from("agents").select("id, name").eq("user_id", user.id).maybeSingle(),
    supabase
      .from("outreach_events")
      .select("id", { count: "exact", head: true })
      .eq("channel", "sms")
      .eq("direction", "inbound")
      .is("read_at", null),
    supabase
      .from("outreach_events")
      .select("id", { count: "exact", head: true })
      .eq("channel", "email")
      .eq("direction", "inbound")
      .is("read_at", null),
    // Admin only: after-hours requests waiting for a decision (sidebar badge).
    role === "admin"
      ? (supabase.from("after_hours_requests") as any).select("id", { count: "exact", head: true }).eq("status", "pending")
      : Promise.resolve({ count: 0 }),
    // Support badge. Admin: tickets waiting for an answer; agent (RLS: own only): unopened answers.
    role === "admin"
      ? (supabase.from("support_tickets") as any).select("id", { count: "exact", head: true }).eq("status", "open")
      : (supabase.from("support_tickets") as any).select("id", { count: "exact", head: true }).eq("agent_unread", true),
  ])

  const agent = agentData as { id: string; name: string } | null
  const userName = agent?.name ?? user.email ?? "User"

  return (
    <SidebarProvider>
      <AppSidebar
        userName={userName}
        userEmail={user.email ?? ""}
        role={role}
        agentId={agent?.id ?? null}
        unreadSmsCount={unreadSmsCount ?? 0}
        unreadEmailCount={unreadEmailCount ?? 0}
        pendingRequestsCount={(pendingRequestsCount as number | null) ?? 0}
        ticketsBadgeCount={(ticketsBadgeCount as number | null) ?? 0}
      />
      <main className="flex flex-1 flex-col min-h-screen">
        <header className="flex items-center h-12 px-4 border-b shrink-0">
          <SidebarTrigger className="-ml-2 size-10 md:-ml-1 md:size-7" />
        </header>
        <div className="flex-1 overflow-y-auto">
          <PageTransition>{children}</PageTransition>
        </div>
      </main>
      <Toaster richColors position="top-right" />
    </SidebarProvider>
  )
}
