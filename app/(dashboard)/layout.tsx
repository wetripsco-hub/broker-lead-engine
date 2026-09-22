import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/layout/app-sidebar"
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
    .select("name")
    .eq("user_id", user.id)
    .maybeSingle()

  const role = (user.user_metadata?.role as UserRole) ?? "agent"
  const userName = (agentData as { name: string } | null)?.name ?? user.email ?? "User"

  return (
    <SidebarProvider>
      <AppSidebar
        userName={userName}
        userEmail={user.email ?? ""}
        role={role}
      />
      <main className="flex flex-1 flex-col min-h-screen">
        <header className="flex items-center h-12 px-4 border-b shrink-0">
          <SidebarTrigger className="-ml-1" />
        </header>
        <div className="flex-1 p-6">{children}</div>
      </main>
      <Toaster richColors position="top-right" />
    </SidebarProvider>
  )
}
