-- 1. Login-screen "Contact Support" requests (e.g. forgotten password).
--    Inserted only by /api/support-request with the service role; only the
--    admin can read and resolve them.
create table if not exists public.support_requests (
  id          uuid primary key default gen_random_uuid(),
  login_id    text not null check (char_length(login_id) <= 254),
  agent_id    uuid references public.agents(id) on delete set null, -- null: no matching agent
  message     text not null check (char_length(message) between 1 and 1000),
  status      text not null default 'open' check (status in ('open', 'resolved')),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  ip_hash     text -- sha256 of the sender's IP, for the 3-per-hour rate limit
);

create index if not exists support_requests_status_created_idx on public.support_requests (status, created_at desc);
create index if not exists support_requests_ip_created_idx on public.support_requests (ip_hash, created_at desc);

alter table public.support_requests enable row level security;

drop policy if exists "support_requests_admin_select" on public.support_requests;
create policy "support_requests_admin_select" on public.support_requests
  for select using (public.is_admin());

drop policy if exists "support_requests_admin_update" on public.support_requests;
create policy "support_requests_admin_update" on public.support_requests
  for update using (public.is_admin()) with check (public.is_admin());

-- 2. First-login walkthrough for agents.
alter table public.agents add column if not exists onboarding_completed_at timestamptz;
alter table public.agents add column if not exists onboarding_step int not null default 0;
-- Existing agents are left with null too, so they see the tour once on their next sign-in.
