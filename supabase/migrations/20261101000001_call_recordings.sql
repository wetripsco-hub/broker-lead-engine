-- Permanent storage for agent call recordings. Telnyx links expire after 10
-- minutes, so the webhook copies each file into this private bucket.
--
-- No storage policies on purpose: only the service role reads/writes the bucket.
-- Signed-in users get a short-lived signed URL from getCallRecordingUrl.

insert into storage.buckets (id, name, public) values ('call-recordings', 'call-recordings', false)
on conflict (id) do nothing;

alter table public.outreach_events
  add column if not exists recording_path text,
  add column if not exists recording_seconds integer;

-- The Telnyx webhook finds call rows by external_id on every call event.
create index if not exists outreach_events_call_external_id_idx
  on public.outreach_events (external_id)
  where channel = 'call' and external_id is not null;

-- Call Reviews page: newest calls first.
create index if not exists outreach_events_calls_occurred_idx
  on public.outreach_events (occurred_at desc)
  where channel = 'call';
