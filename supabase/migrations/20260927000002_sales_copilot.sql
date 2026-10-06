-- Live Sales Copilot: knowledge base, app-level settings, and call
-- transcript / AI summary fields. Run in the Supabase SQL Editor.

-- ============================================================
-- knowledge_base: "manual" docs the copilot may answer from, and the
-- objection "playbook" (one row per objection: title = the objection,
-- content = the approved answer). Everyone signed in can read; only admins
-- write.
-- ============================================================
create table if not exists public.knowledge_base (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  content     text not null default '',
  kind        text not null default 'manual' check (kind in ('manual', 'playbook')),
  sort_order  integer not null default 0,
  updated_by  uuid references public.agents(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger knowledge_base_updated_at
  before update on public.knowledge_base
  for each row execute function public.set_updated_at();

alter table public.knowledge_base enable row level security;

create policy "knowledge_base_select" on public.knowledge_base
  for select using (auth.uid() is not null);
create policy "knowledge_base_insert" on public.knowledge_base
  for insert with check (public.is_admin());
create policy "knowledge_base_update" on public.knowledge_base
  for update using (public.is_admin());
create policy "knowledge_base_delete" on public.knowledge_base
  for delete using (public.is_admin());

-- Objection playbook slots. Content is intentionally empty: the admin
-- writes the approved answers (the copilot never invents them).
insert into public.knowledge_base (title, content, kind, sort_order)
select t.title, '', 'playbook', t.ord
from (values
  ('We already have a software', 1),
  ('Too busy right now', 2),
  ('Send me an email', 3),
  ('What is the price?', 4),
  ('Not interested', 5)
) as t(title, ord)
where not exists (select 1 from public.knowledge_base where kind = 'playbook');

-- ============================================================
-- app_settings: tiny key/value store for admin-controlled switches.
-- ============================================================
create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

alter table public.app_settings enable row level security;

create policy "app_settings_select" on public.app_settings
  for select using (auth.uid() is not null);
create policy "app_settings_insert" on public.app_settings
  for insert with check (public.is_admin());
create policy "app_settings_update" on public.app_settings
  for update using (public.is_admin());

insert into public.app_settings (key, value)
values ('announce_recording', 'false'::jsonb)
on conflict (key) do nothing;

-- ============================================================
-- outreach_events: AI call summary + suggested follow-up date.
-- `transcript` already exists. Read access is governed by the existing
-- outreach_events RLS (admin sees all; an agent only events on leads
-- assigned to them) — transcripts inherit that, no new policy needed.
-- ============================================================
alter table public.outreach_events
  add column if not exists ai_summary text,
  add column if not exists follow_up_date date;
