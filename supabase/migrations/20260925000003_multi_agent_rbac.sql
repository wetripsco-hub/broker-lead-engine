-- Multi-agent RBAC: agent management fields, and scope outreach_events /
-- brokers / email_templates by lead assignment instead of blanket
-- "any authenticated user" access.

alter table public.agents
  add column if not exists email text,
  add column if not exists active boolean not null default true;

create unique index if not exists agents_email_key on public.agents (email) where email is not null;

update public.agents a
set email = u.email
from auth.users u
where a.user_id = u.id and a.email is null;

-- ============================================================
-- outreach_events: scope by the LEAD's current assignment, not by who
-- logged the event, so reassigning a lead hands the new agent the full
-- existing history. Unknown-number events (lead_id null) only match the
-- admin branch, so unlinked SMS stay admin-only.
-- ============================================================
drop policy if exists "outreach_events_select" on public.outreach_events;
drop policy if exists "outreach_events_insert" on public.outreach_events;
drop policy if exists "outreach_events_update" on public.outreach_events;
drop policy if exists "outreach_events_sms_shared_select" on public.outreach_events;

create policy "outreach_events_select" on public.outreach_events
  for select using (
    public.is_admin()
    or lead_id in (select id from public.leads where assigned_agent_id = public.current_agent_id())
  );

create policy "outreach_events_insert" on public.outreach_events
  for insert with check (
    public.is_admin()
    or lead_id in (select id from public.leads where assigned_agent_id = public.current_agent_id())
  );

create policy "outreach_events_update" on public.outreach_events
  for update using (
    public.is_admin()
    or lead_id in (select id from public.leads where assigned_agent_id = public.current_agent_id())
  );

-- ============================================================
-- brokers: agent can only see brokers behind a lead assigned to them.
-- ============================================================
drop policy if exists "brokers_select" on public.brokers;

create policy "brokers_select" on public.brokers
  for select using (
    public.is_admin()
    or id in (select broker_id from public.leads where assigned_agent_id = public.current_agent_id())
  );

-- ============================================================
-- email_templates: admin-only writes (read stays open so agents can still
-- use templates to send email).
-- ============================================================
drop policy if exists "email_templates_insert" on public.email_templates;
drop policy if exists "email_templates_update" on public.email_templates;
drop policy if exists "email_templates_delete" on public.email_templates;

create policy "email_templates_insert" on public.email_templates
  for insert with check (public.is_admin());

create policy "email_templates_update" on public.email_templates
  for update using (public.is_admin());

create policy "email_templates_delete" on public.email_templates
  for delete using (public.is_admin());
