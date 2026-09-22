-- ============================================================
-- Helper: get current user's agent row
-- ============================================================
create or replace function public.current_agent_id()
returns uuid language sql security definer stable as $$
  select id from public.agents where user_id = auth.uid();
$$;

-- Helper: is the current user an admin?
create or replace function public.is_admin()
returns boolean language sql security definer stable as $$
  select coalesce(
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin',
    false
  );
$$;

-- ============================================================
-- agents RLS
-- ============================================================
-- Agents can read their own row; admins read all
create policy "agents_select" on public.agents
  for select using (
    user_id = auth.uid() or public.is_admin()
  );

-- Only the agent themselves or admin can update
create policy "agents_update" on public.agents
  for update using (
    user_id = auth.uid() or public.is_admin()
  );

-- Only admins can insert / delete agents
create policy "agents_insert" on public.agents
  for insert with check (public.is_admin());

create policy "agents_delete" on public.agents
  for delete using (public.is_admin());

-- ============================================================
-- brokers RLS
-- ============================================================
-- All authenticated users can read brokers
create policy "brokers_select" on public.brokers
  for select using (auth.role() = 'authenticated');

-- Only admins can mutate brokers (ingestion runs as service_role)
create policy "brokers_insert" on public.brokers
  for insert with check (public.is_admin());

create policy "brokers_update" on public.brokers
  for update using (public.is_admin());

create policy "brokers_delete" on public.brokers
  for delete using (public.is_admin());

-- ============================================================
-- daily_ingestion_log RLS
-- ============================================================
create policy "ingestion_log_select" on public.daily_ingestion_log
  for select using (auth.role() = 'authenticated');

-- Only admins (or service_role via Edge Function) can insert/update
create policy "ingestion_log_insert" on public.daily_ingestion_log
  for insert with check (public.is_admin());

create policy "ingestion_log_update" on public.daily_ingestion_log
  for update using (public.is_admin());

-- ============================================================
-- leads RLS
-- ============================================================
-- Admin sees all; agent sees only their assigned leads
create policy "leads_select" on public.leads
  for select using (
    public.is_admin()
    or assigned_agent_id = public.current_agent_id()
  );

create policy "leads_insert" on public.leads
  for insert with check (
    public.is_admin()
    or assigned_agent_id = public.current_agent_id()
  );

create policy "leads_update" on public.leads
  for update using (
    public.is_admin()
    or assigned_agent_id = public.current_agent_id()
  );

create policy "leads_delete" on public.leads
  for delete using (public.is_admin());

-- ============================================================
-- outreach_events RLS
-- ============================================================
-- Agent sees events on leads they own; admin sees all
create policy "outreach_events_select" on public.outreach_events
  for select using (
    public.is_admin()
    or agent_id = public.current_agent_id()
  );

create policy "outreach_events_insert" on public.outreach_events
  for insert with check (
    public.is_admin()
    or agent_id = public.current_agent_id()
  );

create policy "outreach_events_update" on public.outreach_events
  for update using (
    public.is_admin()
    or agent_id = public.current_agent_id()
  );

create policy "outreach_events_delete" on public.outreach_events
  for delete using (public.is_admin());

-- ============================================================
-- email_templates RLS
-- ============================================================
-- All authenticated users can read templates
create policy "email_templates_select" on public.email_templates
  for select using (auth.role() = 'authenticated');

-- Any agent can create a template; only creator or admin can mutate it
create policy "email_templates_insert" on public.email_templates
  for insert with check (auth.role() = 'authenticated');

create policy "email_templates_update" on public.email_templates
  for update using (
    public.is_admin()
    or created_by = public.current_agent_id()
  );

create policy "email_templates_delete" on public.email_templates
  for delete using (
    public.is_admin()
    or created_by = public.current_agent_id()
  );
