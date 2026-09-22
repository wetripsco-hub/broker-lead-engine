-- Phase 6: track message direction on outreach_events
-- "outbound" = agent sent, "inbound" = broker replied
alter table outreach_events
  add column if not exists direction text not null default 'outbound'
    check (direction in ('inbound', 'outbound'));
