-- Richer MOTUS account-page data: USDOT status, DBA, business email,
-- operating-authority (MC) status/type, and a per-broker officials table.

alter table public.brokers
  add column if not exists usdot_status text,
  add column if not exists dba_name text,
  add column if not exists business_email text,
  add column if not exists authority_type text
    check (authority_type in ('property', 'household_goods')),
  -- Deliberately NOT constrained: MOTUS is free to report a status string
  -- we haven't seen yet, and a CHECK violation would abort the whole
  -- ingestion run over one unexpected value. The scraper lowercases what
  -- it finds and filters on 'rejected'/'withdrawn'.
  add column if not exists mc_status text;

create table if not exists public.broker_officials (
  id uuid primary key default gen_random_uuid(),
  broker_id uuid not null references public.brokers (id) on delete cascade,
  official_name text not null,
  title text,
  telephone text,
  email text,
  created_at timestamptz not null default now()
);

create index if not exists broker_officials_broker_id_idx
  on public.broker_officials (broker_id);

-- One row per (broker, official) so re-running enrichment can't duplicate.
create unique index if not exists broker_officials_broker_name_idx
  on public.broker_officials (broker_id, official_name);

alter table public.broker_officials enable row level security;

-- Mirrors the brokers table: everyone authenticated reads, admins mutate
-- (the scraper runs as service_role, which bypasses RLS).
create policy "broker_officials_select" on public.broker_officials
  for select using (auth.role() = 'authenticated');

create policy "broker_officials_insert" on public.broker_officials
  for insert with check (public.is_admin());

create policy "broker_officials_update" on public.broker_officials
  for update using (public.is_admin());

create policy "broker_officials_delete" on public.broker_officials
  for delete using (public.is_admin());

-- Per-run breakdown shown on the Ingestion Log page.
alter table public.daily_ingestion_log
  add column if not exists active_count integer not null default 0,
  add column if not exists pending_count integer not null default 0,
  add column if not exists skipped_count integer not null default 0,
  add column if not exists email_count integer not null default 0;
