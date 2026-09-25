-- Phase 6 continued: SMS inbox (thread view across all numbers, not just leads)

-- Track which raw number a message came from / went to, independent of
-- whether it's linked to a lead yet. Needed so unknown-number inbound SMS
-- still show up in the inbox and can be grouped into a conversation.
alter table public.outreach_events
  add column if not exists from_number text,
  add column if not exists to_number text,
  add column if not exists read_at timestamptz;

create index if not exists outreach_events_sms_numbers_idx
  on public.outreach_events (from_number, to_number)
  where channel = 'sms';

create index if not exists outreach_events_sms_unread_idx
  on public.outreach_events (read_at)
  where channel = 'sms' and direction = 'inbound';

-- Backfill from_number/to_number for existing SMS rows from their lead's
-- broker phone (the only number we had before this migration).
update public.outreach_events oe
set to_number = b.phone
from public.leads l join public.brokers b on b.id = l.broker_id
where oe.lead_id = l.id
  and oe.channel = 'sms'
  and oe.direction = 'outbound'
  and oe.to_number is null
  and b.phone is not null;

update public.outreach_events oe
set from_number = b.phone
from public.leads l join public.brokers b on b.id = l.broker_id
where oe.lead_id = l.id
  and oe.channel = 'sms'
  and oe.direction = 'inbound'
  and oe.from_number is null
  and b.phone is not null;

-- The direct-dial constraint only allowed lead_id or direct_number — an
-- unknown-number inbound SMS has neither (it sets from_number/to_number
-- instead), so it would be rejected without this.
alter table public.outreach_events
  drop constraint if exists outreach_events_target_check;
alter table public.outreach_events
  add constraint outreach_events_target_check
    check (
      lead_id is not null
      or direct_number is not null
      or from_number is not null
      or to_number is not null
    );

-- Shared inbox: every authenticated user can see SMS regardless of which
-- agent it's attached to (the existing agent-scoped policy still applies
-- to insert/update/delete, and to the other channels).
create policy "outreach_events_sms_shared_select" on public.outreach_events
  for select using (channel = 'sms' and auth.role() = 'authenticated');

-- Full replica identity so Realtime can evaluate RLS-filtered postgres_changes
-- correctly (needed for the shared SMS select policy above to apply to
-- UPDATE/DELETE payloads too, not just INSERT).
alter table public.outreach_events replica identity full;

-- Enable Realtime for live inbox updates.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'outreach_events'
  ) then
    alter publication supabase_realtime add table public.outreach_events;
  end if;
end $$;
