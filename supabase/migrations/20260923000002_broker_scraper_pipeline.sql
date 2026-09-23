-- Broker-only scraper pipeline (Scrapling): USDOT is known from the daily
-- FMCSA publication PDF; MC number only comes from a follow-up SAFER lookup
-- which can fail (FMCSA blocks cloud/datacenter IPs), so mc_number can no
-- longer be a hard requirement.
alter table brokers alter column mc_number drop not null;

-- dot_number becomes the reliable dedup key for this pipeline
create unique index if not exists brokers_dot_number_unique_idx
  on brokers (dot_number) where dot_number is not null;

alter table brokers
  add column if not exists broker_type text
    check (broker_type in ('property', 'household_goods'));

alter table brokers
  add column if not exists email_confidence text
    check (email_confidence in ('found', 'guessed', 'not_found'));

-- A broker must be identifiable by at least one of MC or DOT number
alter table brokers
  add constraint brokers_mc_or_dot_check check (mc_number is not null or dot_number is not null);
