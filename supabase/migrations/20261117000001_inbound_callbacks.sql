-- Inbound callbacks: brokers calling our Telnyx number back.
--
--   callbacks               one row per inbound call (the caller's leg), written only by the
--                           Telnyx inbound webhook (service role).
--   inbound_call_settings   one row: where to forward, ring time, business hours, greeting.
--
-- Agents may read callbacks for leads assigned to them, but never the phone numbers on them:
-- those columns are withheld from the `authenticated` role (column privileges), so even a
-- hand-written query can't read them. The admin page reads them with the service role.

create table if not exists public.callbacks (
  id                       uuid primary key default gen_random_uuid(),
  call_control_id          text not null unique,          -- the caller's leg; idempotency key
  call_session_id          text,
  caller_number            text,                          -- E.164 when valid, else as received
  to_number                text,
  lead_id                  uuid references public.leads(id) on delete set null,
  agent_id                 uuid references public.agents(id) on delete set null, -- agent who last called the lead
  status                   text not null default 'ringing'
                           check (status in ('ringing', 'forwarding', 'answered', 'missed', 'voicemail')),
  missed_reason            text,                          -- no_answer | busy | declined | after_hours | no_forward_number | caller_hung_up | forward_failed
  forward_to               text,
  forward_call_control_id  text,
  received_at              timestamptz not null default now(),
  answered_at              timestamptz,
  ended_at                 timestamptz,
  greeting_started_at      timestamptz,
  recording_started_at     timestamptz,
  recording_path           text,
  recording_seconds        integer,
  transcript               text,
  transcript_status        text check (transcript_status in ('pending', 'done', 'failed', 'empty')),
  admin_notified_at        timestamptz,
  handled_at               timestamptz,
  handled_by               uuid,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists callbacks_received_idx on public.callbacks (received_at desc);
create index if not exists callbacks_lead_idx on public.callbacks (lead_id, received_at desc) where lead_id is not null;
create index if not exists callbacks_forward_leg_idx on public.callbacks (forward_call_control_id) where forward_call_control_id is not null;
create index if not exists callbacks_open_idx on public.callbacks (received_at desc)
  where handled_at is null and status in ('missed', 'voicemail');

drop trigger if exists callbacks_set_updated_at on public.callbacks;
create trigger callbacks_set_updated_at before update on public.callbacks
  for each row execute function public.set_updated_at();

alter table public.callbacks enable row level security;

drop policy if exists callbacks_select on public.callbacks;
create policy callbacks_select on public.callbacks for select to authenticated
  using (
    public.is_admin()
    or lead_id in (select l.id from public.leads l where l.assigned_agent_id = public.current_agent_id())
  );

-- Only the admin changes a row ("mark handled"); the webhook uses the service role.
drop policy if exists callbacks_update on public.callbacks;
create policy callbacks_update on public.callbacks for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

revoke all on public.callbacks from anon, authenticated;
grant select (
  id, lead_id, agent_id, status, missed_reason, received_at, answered_at, ended_at,
  recording_path, recording_seconds, transcript, transcript_status, handled_at, created_at
) on public.callbacks to authenticated;
grant update (handled_at, handled_by) on public.callbacks to authenticated;

-- Settings (admin only; the admin's own mobile number lives here, so not in app_settings,
-- which every signed-in user can read).
create table if not exists public.inbound_call_settings (
  id                 boolean primary key default true check (id),
  forward_to         text,
  ring_timeout_secs  integer not null default 20 check (ring_timeout_secs between 5 and 60),
  hours_enabled      boolean not null default true,
  timezone           text not null default 'America/Chicago',
  open_days          integer[] not null default '{1,2,3,4,5}', -- 0 = Sunday … 6 = Saturday
  open_time          time not null default '09:00',
  close_time         time not null default '17:00',
  greeting           text not null default 'Thanks for calling Loadlinkers. We missed your call. This message will be recorded. Please leave your name and a short message after the beep, and we will call you back.',
  notify_email       text,
  updated_at         timestamptz not null default now()
);

insert into public.inbound_call_settings (id) values (true) on conflict (id) do nothing;

alter table public.inbound_call_settings enable row level security;

drop policy if exists inbound_call_settings_admin on public.inbound_call_settings;
create policy inbound_call_settings_admin on public.inbound_call_settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

revoke all on public.inbound_call_settings from anon;
