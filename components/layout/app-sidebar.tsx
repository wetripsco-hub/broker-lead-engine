"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  Users,
  RefreshCw,
  Mail,
  Settings,
  LogOut,
} from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { logout } from "@/app/(auth)/login/actions"
import type { UserRole } from "@/types/database"

const navItems = [
  { href: "/dashboard", label: "Dashboard",     icon: LayoutDashboard },
  { href: "/leads",     label: "Leads",         icon: Users },
  { href: "/templates", label: "Templates",     icon: Mail },
  { href: "/ingestion", label: "Ingestion Log", icon: RefreshCw },
  { href: "/settings",  label: "Settings",      icon: Settings },
]

interface AppSidebarProps {
  userName: string
  userEmail: string
  role: UserRole
}

export function AppSidebar({ userName, userEmail, role }: AppSidebarProps) {
  const pathname = usePathname()
  const initials = userName
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase()

  return (
    <Sidebar>
      <SidebarHeader className="px-4 py-4">
        <div className="flex items-center gap-2">
          <div className="size-7 rounded-md bg-foreground shrink-0" aria-hidden />
          <span className="font-semibold text-sm tracking-tight leading-none">
            Broker Lead Engine
          </span>
        </div>
      </SidebarHeader>

      <SidebarSeparator />

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map(({ href, label, icon: Icon }) => (
                <SidebarMenuItem key={href}>
                  <SidebarMenuButton
                    render={<Link href={href} />}
                    isActive={pathname === href || pathname.startsWith(href + "/")}
                  >
                    <Icon className="size-4" />
                    <span>{label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarSeparator />

      <SidebarFooter className="px-3 py-3">
        <div className="flex items-center gap-3 mb-3 px-1">
          <Avatar className="size-7 shrink-0">
            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium leading-none truncate">{userName}</p>
            <p className="text-xs text-muted-foreground truncate mt-0.5">{userEmail}</p>
          </div>
          <Badge variant={role === "admin" ? "default" : "secondary"} className="text-xs shrink-0">
            {role}
          </Badge>
        </div>

        <form action={logout}>
          <button
            type="submit"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors duration-150"
          >
            <LogOut className="size-4" />
            Sign out
          </button>
        </form>
      </SidebarFooter>
    </Sidebar>
  )
}
