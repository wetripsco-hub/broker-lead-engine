# Implementation Plan: Broker Lead Engine — Phase 1 Foundation

## Overview
Phase 1 establishes the complete foundation: a new Next.js App Router project (isolated from FreightLink), a brand-new Supabase project with the full schema, role-based auth (admin/agent), RLS policies enforced at the database level, and a working dashboard shell.

## Architecture Decisions
- **Route groups**: `(auth)` for unauthenticated pages, `(dashboard)` for protected pages — clean separation, no shared layout pollution.
- **Supabase SSR client**: Server Components read via `@supabase/ssr` server client; browser interactions use the browser client. Middleware refreshes the session on every request.
- **Role via `user_metadata`**: Role (`admin` | `agent`) lives in `user.user_metadata.role` (set at invite/creation time). The `is_admin()` SQL helper reads the JWT claim directly — no extra DB round-trip.
- **Auto-create agent row**: A Postgres trigger on `auth.users` inserts into `agents` on signup so every user always has an agent record.
- **RLS enforced in DB**: Agents see only their assigned leads and outreach events; admins see everything. Client-side filtering is secondary.
- **shadcn/ui v4 (Base UI)**: Uses `render` prop pattern instead of `asChild`; sidebar nav uses `render={<Link />}`.

## Phase 1 Status: ✅ COMPLETE

### Tasks
- [x] Task 1: Scaffold Next.js (App Router + TypeScript + Tailwind + shadcn/ui)
- [x] Task 2: Create new Supabase project (`yqalyrelltibsjmrkatb`, us-east-1)
- [x] Task 3: Schema migrations (initial_schema + rls_policies + auth_trigger)
- [x] Task 4: Supabase Auth with role-based RLS (admin/agent)
- [x] Task 5: Dashboard shell (sidebar, layout, all route pages, middleware)

## Supabase Project
- **Project ID**: `yqalyrelltibsjmrkatb`
- **URL**: `https://yqalyrelltibsjmrkatb.supabase.co`
- **Region**: us-east-1
- **Migrations applied**: `initial_schema`, `rls_policies`, `auth_trigger`

## Tables Created
- `agents` — user → agent row, twilio_identity, commission_rate (nullable)
- `brokers` — MC number (unique), full FMCSA profile fields
- `daily_ingestion_log` — run tracking for Phase 2
- `leads` — broker + stage + assigned_agent_id (RLS-protected)
- `outreach_events` — channel + status + timeline (RLS-protected)
- `email_templates` — reusable templates for Phase 4

## Open Decisions (carry forward)
- FMCSA data source: free bulk census file (default for Phase 2)
- Twilio: Voice+SMS number needed before Phase 5 — flag early
- Call recording consent policy: decide before Phase 5
- Email sending domain + SPF/DKIM: decide before Phase 4

## Next Phase
Phase 2: FMCSA ingestion — `BrokerDataProvider` interface, daily job, diff logic, ingestion log page.
