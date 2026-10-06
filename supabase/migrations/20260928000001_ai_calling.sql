-- AI voice-agent calling (Retell now, swappable provider later).
-- Run in the Supabase SQL Editor. Safe to re-run.

-- ============================================================
-- outreach_events: a new channel + provider call data.
-- NOTE: a new enum value can't be used in the same transaction that adds it,
-- so nothing below references 'ai_call'.
-- ============================================================
alter type public.outreach_channel add value if not exists 'ai_call';

alter table public.outreach_events
  add column if not exists provider text,
  add column if not exists provider_call_id text,
  add column if not exists call_status text,            -- queued | registered | in_progress | ended | failed
  add column if not exists sentiment text,
  add column if not exists disposition text,
  add column if not exists duration_seconds integer,
  add column if not exists cost_usd numeric(10, 4),
  add column if not exists ai_summary text,
  add column if not exists ai_callback_time text,        -- raw text from the call analysis
  add column if not exists follow_up_date date,          -- a SUGGESTION only; never changes the stage
  add column if not exists ai_extracted jsonb,
  add column if not exists transcript text,
  add column if not exists recording_url text;

-- A plain UNIQUE constraint (not a partial index) so the webhook can upsert
-- on it. NULLs are allowed many times, so non-AI rows are unaffected.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.outreach_events'::regclass
      and conname = 'outreach_events_provider_call_id_key'
  ) then
    alter table public.outreach_events
      add constraint outreach_events_provider_call_id_key unique (provider_call_id);
  end if;
end $$;

create index if not exists outreach_events_provider_idx
  on public.outreach_events (provider, call_status, occurred_at desc)
  where provider is not null;

-- ============================================================
-- leads: consent + do-not-call
-- ============================================================
alter table public.leads
  add column if not exists ai_call_consent boolean not null default false,
  add column if not exists ai_call_consent_source text,
  add column if not exists ai_call_consent_at timestamptz,
  add column if not exists do_not_call boolean not null default false;

-- Agents can already update their own leads (leads_update policy), so the
-- consent and DND fields need their own guard: only an admin may grant
-- consent or clear a do-not-call. Agents may still flag a lead do-not-call.
-- Service-role / SQL-editor writes (no signed-in user) are trusted, which is
-- what the webhook uses.
create or replace function public.guard_lead_calling_flags()
returns trigger language plpgsql as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;
  if new.ai_call_consent is distinct from old.ai_call_consent
     or new.ai_call_consent_source is distinct from old.ai_call_consent_source
     or new.ai_call_consent_at is distinct from old.ai_call_consent_at then
    raise exception 'Only an admin can change AI-call consent';
  end if;
  if old.do_not_call and not new.do_not_call then
    raise exception 'Only an admin can clear do-not-call';
  end if;
  return new;
end;
$$;

drop trigger if exists leads_guard_calling_flags on public.leads;
create trigger leads_guard_calling_flags
  before update on public.leads
  for each row execute function public.guard_lead_calling_flags();

-- ============================================================
-- do_not_call_numbers: global DNC list, matched on E.164 phone.
-- Read/written by the server (service role) and admins.
-- ============================================================
create table if not exists public.do_not_call_numbers (
  id        uuid primary key default gen_random_uuid(),
  phone     text not null unique,
  reason    text,
  added_at  timestamptz not null default now()
);

alter table public.do_not_call_numbers enable row level security;

drop policy if exists "dnc_select" on public.do_not_call_numbers;
drop policy if exists "dnc_insert" on public.do_not_call_numbers;
drop policy if exists "dnc_delete" on public.do_not_call_numbers;
create policy "dnc_select" on public.do_not_call_numbers for select using (public.is_admin());
create policy "dnc_insert" on public.do_not_call_numbers for insert with check (public.is_admin());
create policy "dnc_delete" on public.do_not_call_numbers for delete using (public.is_admin());

-- ============================================================
-- app_settings (also created by the Copilot migration; repeated so this file
-- stands alone) + AI calling switches. Calling ships OFF and in test mode.
-- ============================================================
create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

alter table public.app_settings enable row level security;

drop policy if exists "app_settings_select" on public.app_settings;
drop policy if exists "app_settings_insert" on public.app_settings;
drop policy if exists "app_settings_update" on public.app_settings;
create policy "app_settings_select" on public.app_settings for select using (auth.uid() is not null);
create policy "app_settings_insert" on public.app_settings for insert with check (public.is_admin());
create policy "app_settings_update" on public.app_settings for update using (public.is_admin());

insert into public.app_settings (key, value) values
  ('ai_calling_enabled',      'false'::jsonb),
  ('ai_calling_test_mode',    'true'::jsonb),
  ('ai_calling_test_numbers', '[]'::jsonb),
  ('ai_calling_daily_cap',    '20'::jsonb)
on conflict (key) do nothing;

-- RLS for ai_call events needs no new policy: outreach_events is already
-- scoped by the lead's assignment (admin sees all, an agent only events on
-- leads assigned to them).
