"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  Users,
  RefreshCw,
  Mail,
  MessageSquare,
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
import { DialerWidget } from "@/components/dialer/dialer-widget"
import { UnreadSmsBadge } from "@/components/messages/unread-sms-badge"
import type { UserRole } from "@/types/database"

const navItems = [
  { href: "/dashboard", label: "Dashboard",     icon: LayoutDashboard },
  { href: "/leads",     label: "Leads",         icon: Users },
]

const secondaryNavItems = [
  { href: "/templates", label: "Templates",     icon: Mail },
  { href: "/ingestion", label: "Ingestion Log", icon: RefreshCw },
]

const settingsItem = { href: "/settings", label: "Settings", icon: Settings }

function NavLink({
  href,
  label,
  icon: Icon,
  active,
  badge,
}: {
  href: string
  label: string
  icon: React.ElementType
  active: boolean
  badge?: React.ReactNode
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        render={<Link href={href} />}
        isActive={active}
        className="relative transition-colors duration-150 ease-[var(--ease-out)] data-[active=true]:font-medium"
      >
        {active && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-0.5 rounded-full bg-primary animate-in-fade" />
        )}
        <Icon className="size-4 transition-transform duration-150 ease-[var(--ease-out)] group-hover/menu-item:translate-x-0.5" />
        <span>{label}</span>
        {badge}
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

interface AppSidebarProps {
  userName: string
  userEmail: string
  role: UserRole
  agentId: string | null
  unreadSmsCount: number
}

export function AppSidebar({ userName, userEmail, role, agentId, unreadSmsCount }: AppSidebarProps) {
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
        <div className="flex items-center gap-2.5">
          <div className="size-7 rounded-md bg-foreground shrink-0 transition-transform duration-200 ease-[var(--ease-out)] hover:scale-105" aria-hidden />
          <span className="font-semibold text-sm tracking-tight leading-none">
            Broker Lead Engine
          </span>
        </div>
      </SidebarHeader>

      <SidebarSeparator />

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {navItems.map(({ href, label, icon }) => (
                <NavLink
                  key={href}
                  href={href}
                  label={label}
                  icon={icon}
                  active={pathname === href || pathname.startsWith(href + "/")}
                />
              ))}
              <NavLink
                href="/messages"
                label="Messages"
                icon={MessageSquare}
                active={pathname === "/messages" || pathname.startsWith("/messages/")}
                badge={<UnreadSmsBadge initialCount={unreadSmsCount} />}
              />
              {secondaryNavItems.map(({ href, label, icon }) => (
                <NavLink
                  key={href}
                  href={href}
                  label={label}
                  icon={icon}
                  active={pathname === href || pathname.startsWith(href + "/")}
                />
              ))}
              <SidebarMenuItem>
                <DialerWidget agentId={agentId} />
              </SidebarMenuItem>
              <NavLink
                href={settingsItem.href}
                label={settingsItem.label}
                icon={settingsItem.icon}
                active={pathname === settingsItem.href || pathname.startsWith(settingsItem.href + "/")}
              />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarSeparator />

      <SidebarFooter className="px-3 py-3 gap-1">
        <div className="flex items-center gap-3 mb-2 px-1">
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
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] hover:text-foreground hover:bg-accent active:scale-[0.98]"
          >
            <LogOut className="size-4" />
            Sign out
          </button>
        </form>
      </SidebarFooter>
    </Sidebar>
  )
}
