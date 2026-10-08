-- Calling-hours exemptions for AI calls (test-mode numbers; admin override).
-- Run in the Supabase SQL Editor. Safe to re-run.

-- Admin override switch. OFF by default: nothing changes until an admin turns
-- it on in Settings -> AI calling.
insert into public.app_settings (key, value)
values ('ai_call_allow_admin_hours_override', 'false'::jsonb)
on conflict (key) do nothing;

-- Audit trail on the call itself. A row is only written with these set when
-- calling hours were actually skipped (agent_id on the row = who placed it).
alter table public.outreach_events
  add column if not exists hours_exemption  text,      -- 'test_mode' | 'admin_override'
  add column if not exists hours_override   boolean not null default false,
  add column if not exists broker_local_time text;     -- e.g. '11:42 PM EDT' when the call was placed

-- Quick review of every override that has been used:
--   select occurred_at, agent_id, lead_id, broker_local_time
--   from public.outreach_events where hours_override order by occurred_at desc;
