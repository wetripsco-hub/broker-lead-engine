-- Email open/click tracking

alter type public.outreach_status add value if not exists 'opened';
alter type public.outreach_status add value if not exists 'clicked';

alter table public.outreach_events
  add column if not exists opened_at timestamptz,
  add column if not exists open_count integer not null default 0,
  add column if not exists clicked_at timestamptz,
  add column if not exists click_count integer not null default 0;
