-- Standalone sidebar dialer: calls not tied to a lead.
-- lead_id becomes optional; direct_number stores the manually-dialed number.
alter table outreach_events
  alter column lead_id drop not null;

alter table outreach_events
  add column if not exists direct_number text;

-- Every event must be tied to either a lead or a manually-dialed number
alter table outreach_events
  add constraint outreach_events_target_check
    check (lead_id is not null or direct_number is not null);
