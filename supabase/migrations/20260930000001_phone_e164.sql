-- Phone numbers: one canonical E.164 form everything matches on.
--
-- Run order (the backfill needs the real phone library, so it is a script,
-- not SQL — SQL can't tell a valid number from a fake one like 555-000-9911):
--   1. STEP 1 below (columns + checks), in the SQL Editor.
--   2. Backfill:   npx tsx --env-file=.env.local scripts/backfill-phone-e164.ts          (dry run, prints counts)
--                  npx tsx --env-file=.env.local scripts/backfill-phone-e164.ts --apply  (writes)
--   3. STEP 3 below: the counts should now read 0 except genuinely invalid numbers.
--
-- brokers.phone, officials' telephone and old outreach_events rows keep their
-- original text; only the new *_e164 columns (and DNC / SMS number columns,
-- which are keys, not display text) are normalised.

-- ============================================================================
-- STEP 1 — schema
-- ============================================================================
alter table public.brokers
  add column if not exists phone_e164 text;

alter table public.outreach_events
  add column if not exists direct_number_e164 text;

create index if not exists brokers_phone_e164_idx on public.brokers (phone_e164);
create index if not exists outreach_events_direct_number_e164_idx
  on public.outreach_events (direct_number_e164) where direct_number_e164 is not null;

-- Whatever writes these columns (the app, the Python scraper, a manual SQL
-- edit), a value that isn't E.164 is rejected instead of silently stored.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'brokers_phone_e164_format') then
    alter table public.brokers
      add constraint brokers_phone_e164_format
      check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{6,14}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'outreach_events_direct_number_e164_format') then
    alter table public.outreach_events
      add constraint outreach_events_direct_number_e164_format
      check (direct_number_e164 is null or direct_number_e164 ~ '^\+[1-9][0-9]{6,14}$');
  end if;
  -- do_not_call_numbers.phone has always been intended to hold E.164. Existing
  -- rows may not (NOT VALID = checked for new/changed rows only); the backfill
  -- fixes old ones, after which this can be validated.
  if not exists (select 1 from pg_constraint where conname = 'dnc_phone_e164_format') then
    alter table public.do_not_call_numbers
      add constraint dnc_phone_e164_format
      check (phone ~ '^\+[1-9][0-9]{6,14}$') not valid;
  end if;
end $$;

-- ============================================================================
-- STEP 3 — check (run any time; BEFORE the backfill it shows what's pending,
-- AFTER it everything should be 0 apart from truly invalid numbers)
-- ============================================================================
select 'brokers: phone present, phone_e164 empty'            as what,
       count(*) as n
from public.brokers where nullif(btrim(phone), '') is not null and phone_e164 is null
union all
select 'do_not_call_numbers: phone not in E.164 form',
       count(*)
from public.do_not_call_numbers where phone !~ '^\+[1-9][0-9]{6,14}$'
union all
select 'outreach_events: direct_number present, direct_number_e164 empty',
       count(*)
from public.outreach_events where nullif(btrim(direct_number), '') is not null and direct_number_e164 is null
union all
select 'outreach_events (sms): from/to number not in E.164 form',
       count(*)
from public.outreach_events
where channel = 'sms'
  and ((from_number is not null and from_number !~ '^\+[1-9][0-9]{6,14}$')
    or (to_number   is not null and to_number   !~ '^\+[1-9][0-9]{6,14}$'));
