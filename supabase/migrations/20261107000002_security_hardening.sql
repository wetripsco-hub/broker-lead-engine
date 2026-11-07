-- Security hardening. App behaviour for admins and agents stays the same.

-- ─── 1. Role lives in app_metadata, not user_metadata ────────────────────────
-- user_metadata can be edited by the signed-in user (supabase.auth.updateUser),
-- so reading the role from it let any agent make themselves admin. app_metadata
-- can only be written with the service role. Copy every existing role over.
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
                        || jsonb_build_object('role', raw_user_meta_data ->> 'role')
where raw_user_meta_data ->> 'role' in ('admin', 'agent')
  and (raw_app_meta_data ->> 'role') is distinct from (raw_user_meta_data ->> 'role');

-- Read the role from the user record (not the JWT), so it is correct straight
-- away, even for sessions whose token was issued before this change.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select (u.raw_app_meta_data ->> 'role') = 'admin' from auth.users u where u.id = auth.uid()),
    false
  );
$$;

-- ─── 2. Fixed search_path on every flagged function ──────────────────────────
alter function public.set_updated_at() set search_path = public, pg_temp;
alter function public.current_agent_id() set search_path = public, pg_temp;
alter function public.is_admin() set search_path = public, pg_temp;
alter function public.handle_new_user() set search_path = public, pg_temp;
alter function public.create_lead_for_new_broker() set search_path = public, pg_temp;
alter function public.find_lead_for_email(text) set search_path = public, pg_temp;
alter function public.guard_lead_calling_flags() set search_path = public, pg_temp;
alter function public.guard_agent_ip_location() set search_path = public, pg_temp;
alter function public.guard_agent_comp() set search_path = public, pg_temp;
alter function public.record_customer_payment(uuid, jsonb, date, bigint, text, text, jsonb) set search_path = public, pg_temp;
alter function public.cancel_customer(uuid, date) set search_path = public, pg_temp;

-- ─── 3. SECURITY DEFINER functions: no RPC access that isn't needed ──────────
-- Trigger functions: fired by triggers only (firing a trigger needs no EXECUTE).
revoke execute on function public.create_lead_for_new_broker() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
-- Used by RLS policies for signed-in users; nobody needs them before login.
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.current_agent_id() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;
grant execute on function public.current_agent_id() to authenticated, service_role;
-- Already server-only; restated so this file is the full picture.
revoke execute on function public.find_lead_for_email(text) from public, anon, authenticated;
grant execute on function public.find_lead_for_email(text) to service_role;

-- Trigger-only SECURITY INVOKER functions: no reason to expose them as RPC either.
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.guard_lead_calling_flags() from public, anon, authenticated;
revoke execute on function public.guard_agent_ip_location() from public, anon, authenticated;
revoke execute on function public.guard_agent_comp() from public, anon, authenticated;

-- ─── 4. Per-IP rate limiting (fixed window), server-only ─────────────────────
create table if not exists public.api_rate_limits (
  key          text primary key,
  window_start timestamptz not null default now(),
  hits         integer not null default 1
);
alter table public.api_rate_limits enable row level security;
revoke all on table public.api_rate_limits from anon, authenticated;

-- Counts one hit for `p_key` and says whether it is still within `p_max` per window.
create or replace function public.rate_limit_hit(p_key text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_hits integer;
begin
  insert into public.api_rate_limits as r (key, window_start, hits)
  values (p_key, now(), 1)
  on conflict (key) do update set
    hits = case when r.window_start <= now() - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end,
    window_start = case when r.window_start <= now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
  returning hits into v_hits;

  -- Occasional clean-up of old windows.
  if random() < 0.01 then
    delete from public.api_rate_limits where window_start < now() - interval '1 day';
  end if;

  return v_hits <= p_max;
end;
$$;
revoke execute on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;
