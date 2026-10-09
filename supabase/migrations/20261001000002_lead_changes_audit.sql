-- Audit log for admin edits and deletions of leads.
-- Run in the Supabase SQL Editor. Safe to re-run.
--
-- Deleting a lead is refused if this row can't be written (no record, no delete),
-- and the row keeps a full snapshot of what was deleted. Edits are logged with
-- the old and new values of every field that changed.

create table if not exists public.lead_changes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  user_email   text,
  changed_at   timestamptz not null default now(),
  action       text not null check (action in ('edit', 'delete')),
  lead_id      uuid not null,          -- deliberately NOT a foreign key: the lead may be gone
  company_name text,
  mc_number    text,
  details      jsonb
);

create index if not exists lead_changes_changed_at_idx on public.lead_changes (changed_at desc);
create index if not exists lead_changes_lead_id_idx on public.lead_changes (lead_id);

alter table public.lead_changes enable row level security;

drop policy if exists "lead_changes_select" on public.lead_changes;
drop policy if exists "lead_changes_insert" on public.lead_changes;

create policy "lead_changes_select" on public.lead_changes
  for select using (public.is_admin());

create policy "lead_changes_insert" on public.lead_changes
  for insert with check (public.is_admin() and user_id = auth.uid());

-- No update/delete policy on purpose: the trail can't be edited from the app.

-- Review:
--   select changed_at, user_email, action, company_name, mc_number from public.lead_changes order by changed_at desc limit 50;
-- A deleted lead's full snapshot (broker details, stage, how many events were removed):
--   select details from public.lead_changes where action = 'delete' order by changed_at desc limit 1;
