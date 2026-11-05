-- Agent's own time zone, from the IP they connect from (doc/AGENT_TIMEZONE_RUNBOOK.md).
-- Written by the heartbeat and by sign-in with the service role. Used only to DISPLAY
-- agent-facing times; the calling rules keep using the broker's time zone.
-- Run in the Supabase SQL Editor. Safe to re-run.

alter table public.agents add column if not exists ip_timezone text;
alter table public.agents add column if not exists ip_country text;
alter table public.agents add column if not exists ip_city text;
alter table public.agents add column if not exists ip_location_at timestamptz;

-- A signed-in non-admin can't set these straight through the API (agents may update
-- their own row for last_seen_at, so RLS alone doesn't stop it). The service role
-- has no signed-in user, so the app's own writes pass.
create or replace function public.guard_agent_ip_location()
returns trigger language plpgsql as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;
  if new.ip_timezone is distinct from old.ip_timezone
     or new.ip_country is distinct from old.ip_country
     or new.ip_city is distinct from old.ip_city
     or new.ip_location_at is distinct from old.ip_location_at then
    raise exception 'Location is recorded by the app, not edited directly';
  end if;
  return new;
end;
$$;

drop trigger if exists agents_guard_ip_location on public.agents;
create trigger agents_guard_ip_location
  before update on public.agents
  for each row execute function public.guard_agent_ip_location();
