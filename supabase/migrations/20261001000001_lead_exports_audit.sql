-- Audit log for "Export to Excel" on the Leads page.
-- One row per export: who, when, how many rows, and which option.
-- Run in the Supabase SQL Editor. Safe to re-run.
--
-- The export is refused if this row can't be written (no record, no file), so run
-- this BEFORE using the Export button.

create table if not exists public.lead_exports (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,                       -- auth.users.id of whoever exported
  user_email    text,
  exported_at   timestamptz not null default now(),
  export_option text not null check (export_option in ('all', 'filtered', 'selected')),
  row_count     integer not null check (row_count >= 0),
  file_name     text,
  filters       jsonb                                 -- the filters on screen at the time (filtered option)
);

create index if not exists lead_exports_exported_at_idx on public.lead_exports (exported_at desc);

alter table public.lead_exports enable row level security;

drop policy if exists "lead_exports_select" on public.lead_exports;
drop policy if exists "lead_exports_insert" on public.lead_exports;

-- Admins can read the log, and can add a row only as themselves.
create policy "lead_exports_select" on public.lead_exports
  for select using (public.is_admin());

create policy "lead_exports_insert" on public.lead_exports
  for insert with check (public.is_admin() and user_id = auth.uid());

-- No update or delete policy on purpose: nobody can edit or erase the trail
-- from the app. (The SQL editor / service role can still, for housekeeping.)

-- Review recent exports:
--   select exported_at, user_email, export_option, row_count, file_name
--   from public.lead_exports order by exported_at desc limit 50;
