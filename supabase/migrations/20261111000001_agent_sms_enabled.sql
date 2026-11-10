-- Per-agent SMS access. Off by default: an admin ticks "SMS on" on the Agents page
-- for each agent who may text leads. Admins can always text (do-not-call still applies).
alter table public.agents add column if not exists sms_enabled boolean not null default false;

-- Agents may update their own agents row (presence, onboarding), so this column is
-- guarded the same way as the pay-terms columns: only an admin (or the server) may change it.
create or replace function public.guard_agent_sms()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;
  if new.sms_enabled is distinct from old.sms_enabled then
    raise exception 'SMS access is set by the admin';
  end if;
  return new;
end;
$$;

drop trigger if exists agents_guard_sms on public.agents;
create trigger agents_guard_sms before update on public.agents
  for each row execute function public.guard_agent_sms();
