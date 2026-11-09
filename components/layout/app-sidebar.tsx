"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  LayoutDashboard,
  Users,
  RefreshCw,
  Mail,
  MessageSquare,
  Inbox,
  Settings,
  LogOut,
  UserCog,
  BookOpen,
  PhoneCall,
  Building2,
  Clock,
  LifeBuoy,
  KeyRound,
  UserRound,
  CircleHelp,
  PlayCircle,
  ScrollText,
  BadgeDollarSign,
  Wallet,
  UserPlus,
  Clapperboard,
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { logout } from "@/app/(auth)/login/actions"
import { DialerWidget } from "@/components/dialer/dialer-widget"
import { UnreadSmsBadge } from "@/components/messages/unread-sms-badge"
import { PendingRequestsBadge } from "@/components/requests/pending-requests-badge"
import { TicketsBadge } from "@/components/tickets/tickets-badge"
import { SupportRequestsBadge } from "@/components/requests/support-requests-badge"
import type { UserRole } from "@/types/database"

// `adminOnly` items are not rendered for agents (the pages also redirect them).
const navItems = [
  { href: "/dashboard", label: "Dashboard",     icon: LayoutDashboard },
  { href: "/leads",     label: "Leads",         icon: Users },
  { href: "/settings/knowledge", label: "Knowledge", icon: BookOpen, adminOnly: true },
  { href: "/company",   label: "Company",       icon: Building2 },
  { href: "/script",    label: "Call script",   icon: ScrollText },
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
  unreadEmailCount: number
  /** Admin only: after-hours call requests waiting for a decision. */
  pendingRequestsCount?: number
  /** Admin: tickets waiting for an answer. Agent: answers not opened yet. */
  ticketsBadgeCount?: number
  /** Admin only: open "Contact Support" requests from the login screen. */
  supportRequestsCount?: number
}

export function AppSidebar({ userName, userEmail, role, agentId, unreadSmsCount, unreadEmailCount, pendingRequestsCount = 0, ticketsBadgeCount = 0, supportRequestsCount = 0 }: AppSidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const isAdmin = role === "admin"
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
              {navItems.filter((item) => isAdmin || !item.adminOnly).map(({ href, label, icon }) => (
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
              <NavLink
                href="/emails"
                label="Emails"
                icon={Inbox}
                active={pathname === "/emails" || pathname.startsWith("/emails/")}
                badge={<UnreadSmsBadge initialCount={unreadEmailCount} channel="email" />}
              />
              <NavLink
                href="/tickets"
                label="Support"
                icon={LifeBuoy}
                active={pathname === "/tickets" || pathname.startsWith("/tickets/")}
                badge={<TicketsBadge initialCount={ticketsBadgeCount} isAdmin={isAdmin} />}
              />
              {!isAdmin && (
                <NavLink
                  href="/account"
                  label="My Account"
                  icon={UserRound}
                  active={pathname === "/account"}
                />
              )}
              {/* Agent view is intentionally limited to Dashboard, Leads, Company, Call script,
                  Messages, Emails, Support and My Account — everything below is admin-only. The server-side
                  page guards are what actually enforce this; hiding the
                  links is just so an agent never sees a dead end. */}
              {isAdmin && (
                <>
                  {secondaryNavItems.map(({ href, label, icon }) => (
                    <NavLink
                      key={href}
                      href={href}
                      label={label}
                      icon={icon}
                      active={pathname === href || pathname.startsWith(href + "/")}
                    />
                  ))}
                  <NavLink
                    href="/agents"
                    label="Agents"
                    icon={UserCog}
                    active={pathname === "/agents" || pathname.startsWith("/agents/")}
                  />
                  <NavLink
                    href="/recruiter"
                    label="Recruiter"
                    icon={UserPlus}
                    active={pathname === "/recruiter"}
                  />
                  <NavLink
                    href="/customers"
                    label="Customers"
                    icon={BadgeDollarSign}
                    active={pathname === "/customers"}
                  />
                  <NavLink
                    href="/payouts"
                    label="Payouts"
                    icon={Wallet}
                    active={pathname === "/payouts"}
                  />
                  <NavLink
                    href="/requests"
                    label="Requests"
                    icon={Clock}
                    active={pathname === "/requests" || pathname.startsWith("/requests/")}
                    badge={<PendingRequestsBadge initialCount={pendingRequestsCount} />}
                  />
                  <NavLink
                    href="/support-requests"
                    label="Support Requests"
                    icon={KeyRound}
                    active={pathname === "/support-requests"}
                    badge={<SupportRequestsBadge initialCount={supportRequestsCount} />}
                  />
                  <NavLink
                    href="/calls"
                    label="Call Reviews"
                    icon={PhoneCall}
                    active={pathname === "/calls" || pathname.startsWith("/calls/")}
                  />
                  <SidebarMenuItem>
                    <DialerWidget agentId={agentId} />
                  </SidebarMenuItem>
                  <NavLink
                    href={settingsItem.href}
                    label={settingsItem.label}
                    icon={settingsItem.icon}
                    active={pathname === settingsItem.href || pathname.startsWith(settingsItem.href + "/")}
                  />
                </>
              )}
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

        {!isAdmin && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] hover:text-foreground hover:bg-accent active:scale-[0.98]"
                />
              }
            >
              <CircleHelp className="size-4" />
              Help
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" className="min-w-52">
              <DropdownMenuItem onClick={() => window.open("/training", "_blank", "noopener")}>
                <Clapperboard className="size-4" />
                Training hub
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push("/onboarding/tour?replay=1")}>
                <PlayCircle className="size-4" />
                Replay walkthrough
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push("/tickets?new=1")}>
                <LifeBuoy className="size-4" />
                Ask admin a question
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

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
