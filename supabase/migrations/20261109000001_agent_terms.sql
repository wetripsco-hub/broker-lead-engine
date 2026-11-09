-- Per-agent commission terms (levels, salary review rule, offer label, effective date, notes).
-- Safe to re-run.
--
-- - commission_templates: the admin-editable default ("Launch offer"). One row has is_default.
-- - agent_terms: one row per agent. A new agent COPIES the default at creation (trigger below);
--   editing the default later never touches existing agents' rows.
-- - Both tables are admin-only under RLS. An agent reads their own levels through
--   my_agent_terms(), which never returns the salary rule or the admin notes.

-- ── Tables ───────────────────────────────────────────────────────────────────
create table if not exists public.commission_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_default boolean not null default false,
  -- [{ "name": "Bronze", "rate": 0.30, "min": 0, "salary_review": false }, ...] sorted by min
  levels jsonb not null,
  -- { "min_active": 50, "min_scale": 10, "min_growth": 10 }
  salary_rule jsonb not null,
  offer_label text,
  notes text,
  updated_at timestamptz not null default now()
);
create unique index if not exists commission_templates_one_default on public.commission_templates (is_default) where is_default;

create table if not exists public.agent_terms (
  agent_id uuid primary key references public.agents(id) on delete cascade,
  levels jsonb not null,
  salary_rule jsonb not null,
  offer_label text,
  effective_date date not null default current_date,
  notes text,
  copied_from_template uuid references public.commission_templates(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Default template: "Launch offer" ────────────────────────────────────────
insert into public.commission_templates (name, is_default, levels, salary_rule, offer_label, notes)
select
  'Launch offer',
  true,
  '[{"name":"Bronze","rate":0.30,"min":0,"salary_review":false},
    {"name":"Silver","rate":0.35,"min":10,"salary_review":false},
    {"name":"Gold","rate":0.40,"min":25,"salary_review":false},
    {"name":"Platinum","rate":0.40,"min":50,"salary_review":true}]'::jsonb,
  '{"min_active":50,"min_scale":10,"min_growth":10}'::jsonb,
  'Launch offer – Nov 2026',
  null
where not exists (select 1 from public.commission_templates where is_default);

-- ── Copy the default to every new agent ─────────────────────────────────────
create or replace function public.copy_default_terms_to_agent()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.agent_terms (agent_id, levels, salary_rule, offer_label, effective_date, copied_from_template)
  select new.id, t.levels, t.salary_rule, t.offer_label, current_date, t.id
    from public.commission_templates t
   where t.is_default
  on conflict (agent_id) do nothing;
  return new;
end;
$$;
revoke all on function public.copy_default_terms_to_agent() from public, anon, authenticated;

drop trigger if exists agents_copy_default_terms on public.agents;
create trigger agents_copy_default_terms
  after insert on public.agents
  for each row execute function public.copy_default_terms_to_agent();

-- Existing agents get the default once (their current levels are the same numbers).
insert into public.agent_terms (agent_id, levels, salary_rule, offer_label, effective_date, copied_from_template)
select a.id, t.levels, t.salary_rule, t.offer_label, current_date, t.id
  from public.agents a
  cross join public.commission_templates t
 where t.is_default
on conflict (agent_id) do nothing;

-- ── RLS: admin only ─────────────────────────────────────────────────────────
alter table public.commission_templates enable row level security;
alter table public.agent_terms enable row level security;

drop policy if exists "commission_templates_admin_all" on public.commission_templates;
create policy "commission_templates_admin_all" on public.commission_templates
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "agent_terms_admin_all" on public.agent_terms;
create policy "agent_terms_admin_all" on public.agent_terms
  for all using (public.is_admin()) with check (public.is_admin());

-- ── Agent's own view: levels + label + date only (no salary rule, no notes) ─
create or replace function public.my_agent_terms()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'levels', t.levels,
    'offer_label', t.offer_label,
    'effective_date', t.effective_date
  )
    from public.agent_terms t
   where t.agent_id = public.current_agent_id();
$$;
revoke all on function public.my_agent_terms() from public, anon;
grant execute on function public.my_agent_terms() to authenticated;
