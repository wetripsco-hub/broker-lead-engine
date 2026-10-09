-- Favorites (star) on leads. Personal: each user has their own favorites and
-- nobody else can see or change them (an admin's stars are not the agents' stars).
-- Run in the Supabase SQL Editor. Safe to re-run.

create table if not exists public.lead_favorites (
  user_id    uuid not null default auth.uid(),
  lead_id    uuid not null references public.leads(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, lead_id)
);

create index if not exists lead_favorites_lead_id_idx on public.lead_favorites (lead_id);

alter table public.lead_favorites enable row level security;

drop policy if exists "lead_favorites_select" on public.lead_favorites;
drop policy if exists "lead_favorites_insert" on public.lead_favorites;
drop policy if exists "lead_favorites_delete" on public.lead_favorites;

-- Own rows only.
create policy "lead_favorites_select" on public.lead_favorites
  for select using (user_id = auth.uid());

-- Own rows only, and only for a lead the user can actually see (the subquery
-- runs under the leads policies, so an agent can't star someone else's lead).
create policy "lead_favorites_insert" on public.lead_favorites
  for insert with check (
    user_id = auth.uid()
    and exists (select 1 from public.leads l where l.id = lead_id)
  );

create policy "lead_favorites_delete" on public.lead_favorites
  for delete using (user_id = auth.uid());

-- A deleted lead takes its stars with it (on delete cascade above).
