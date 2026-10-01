-- Email inbox: inbound replies synced from IMAP, shown in the lead timeline
-- and the /emails page.

alter table public.outreach_events
  add column if not exists subject text,
  add column if not exists body_html text,
  add column if not exists from_email text,
  add column if not exists to_email text,
  add column if not exists message_id text,
  add column if not exists in_reply_to text,
  add column if not exists email_references text,
  add column if not exists received_at timestamptz,
  add column if not exists send_error text;

-- RFC 5322 Message-ID is the dedup key: re-running a sync can never
-- import the same message twice.
create unique index if not exists outreach_events_message_id_key
  on public.outreach_events (message_id)
  where message_id is not null;

create index if not exists outreach_events_email_unread_idx
  on public.outreach_events (read_at)
  where channel = 'email' and direction = 'inbound';

-- Outbound email used to store "Subject: ...\n\n<body>" in message_body and
-- "Failed: <reason>" for failures. Subject and error now have their own
-- columns; move the legacy rows over so the inbox can show them properly.
update public.outreach_events
set subject = substring(message_body from '^Subject: ([^\n]*)'),
    send_error = case when status = 'failed' then substring(message_body from '\n\nFailed: (.*)$') end,
    message_body = case
      when status = 'failed' and message_body ~ '\n\nFailed: ' then null
      else regexp_replace(message_body, '^Subject: [^\n]*\n\n', '')
    end
where channel = 'email'
  and direction = 'outbound'
  and subject is null
  and message_body like 'Subject: %';

-- An unmatched inbound email has no lead, no direct_number and no phone
-- numbers — only from_email/to_email — so the "must target something"
-- constraint has to accept those too.
alter table public.outreach_events
  drop constraint if exists outreach_events_target_check;
alter table public.outreach_events
  add constraint outreach_events_target_check
    check (
      lead_id is not null
      or direct_number is not null
      or from_number is not null
      or to_number is not null
      or from_email is not null
      or to_email is not null
    );

-- Single-row cursor for the IMAP sync.
create table if not exists public.email_sync_state (
  id              text primary key,
  last_uid        bigint not null default 0,
  uid_validity    bigint,
  last_synced_at  timestamptz,
  last_imported   integer not null default 0,
  last_error      text
);

alter table public.email_sync_state enable row level security;

-- Written only by the sync (service role); admins can read it for the
-- "last synced" indicator.
create policy "email_sync_state_select" on public.email_sync_state
  for select using (public.is_admin());

-- Sender address -> most recent lead whose broker or one of its company
-- officials uses that address. Service-role only (it returns lead ids).
create or replace function public.find_lead_for_email(addr text)
returns uuid language sql security definer stable as $$
  select l.id
  from public.leads l
  join public.brokers b on b.id = l.broker_id
  where lower(b.email) = lower(addr)
     or lower(b.business_email) = lower(addr)
     or exists (
       select 1 from public.broker_officials o
       where o.broker_id = b.id and lower(o.email) = lower(addr)
     )
  order by l.created_at desc
  limit 1;
$$;

revoke all on function public.find_lead_for_email(text) from public, anon, authenticated;
grant execute on function public.find_lead_for_email(text) to service_role;
