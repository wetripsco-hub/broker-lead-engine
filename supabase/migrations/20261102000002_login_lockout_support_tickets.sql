-- Sign-in lockout counter + support tickets.
-- Run in the Supabase SQL Editor. Safe to re-run.

-- ============================================================
-- login_attempts: wrong-password counter per email.
-- RLS on with NO policies: only the service role (server action) touches it,
-- so nobody can read or reset it from the browser.
-- ============================================================
create table if not exists public.login_attempts (
  email            text primary key,
  failed_count     int not null default 0,
  first_failed_at  timestamptz,
  locked_until     timestamptz,
  updated_at       timestamptz not null default now()
);
alter table public.login_attempts enable row level security;

-- ============================================================
-- support_tickets + ticket_messages
-- Agents see their own tickets, the admin sees all. Writes go through server
-- actions (service role) after checking who is asking; the policies below are
-- the second line of defence.
-- ============================================================
create table if not exists public.support_tickets (
  id               uuid primary key default gen_random_uuid(),
  agent_id         uuid not null references public.agents(id) on delete cascade,
  lead_id          uuid references public.leads(id) on delete set null,
  topic            text not null check (topic in ('client', 'own')),
  subject          text not null check (length(btrim(subject)) > 0),
  status           text not null default 'open' check (status in ('open', 'answered', 'closed')),
  -- The agent hasn't seen the admin's latest answer yet (agent's badge).
  agent_unread     boolean not null default false,
  created_at       timestamptz not null default now(),
  last_message_at  timestamptz not null default now(),
  closed_at        timestamptz
);

create index if not exists support_tickets_agent_idx on public.support_tickets (agent_id, last_message_at desc);
create index if not exists support_tickets_status_idx on public.support_tickets (status, last_message_at desc);

create table if not exists public.ticket_messages (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references public.support_tickets(id) on delete cascade,
  author_id   uuid not null,
  from_admin  boolean not null default false,
  body        text not null check (length(btrim(body)) > 0),
  created_at  timestamptz not null default now()
);

create index if not exists ticket_messages_ticket_idx on public.ticket_messages (ticket_id, created_at);

alter table public.support_tickets enable row level security;
alter table public.ticket_messages enable row level security;

drop policy if exists "support_tickets_select" on public.support_tickets;
drop policy if exists "support_tickets_insert" on public.support_tickets;
drop policy if exists "support_tickets_update" on public.support_tickets;
drop policy if exists "ticket_messages_select" on public.ticket_messages;
drop policy if exists "ticket_messages_insert" on public.ticket_messages;

create policy "support_tickets_select" on public.support_tickets
  for select using (public.is_admin() or agent_id = public.current_agent_id());

create policy "support_tickets_insert" on public.support_tickets
  for insert with check (
    agent_id = public.current_agent_id()
    and (lead_id is null or lead_id in (select id from public.leads where assigned_agent_id = public.current_agent_id()))
  );

create policy "support_tickets_update" on public.support_tickets
  for update using (public.is_admin());

create policy "ticket_messages_select" on public.ticket_messages
  for select using (
    ticket_id in (select id from public.support_tickets)  -- runs under the tickets policy
  );

create policy "ticket_messages_insert" on public.ticket_messages
  for insert with check (
    author_id = auth.uid()
    and ticket_id in (select id from public.support_tickets)
  );
