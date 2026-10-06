-- Follow-up due: a lead is "due" when its latest outbound email has had no
-- reply for N days. Computed live in a view (never written by a cron job) so
-- it can't drift out of sync with outreach_events.

alter table public.leads
  add column if not exists follow_up_snoozed_until timestamptz;

alter table public.email_templates
  add column if not exists type text not null default 'initial'
    check (type in ('initial', 'follow_up'));

-- Default follow-up template (short, friendly reminder). Only seeded once.
insert into public.email_templates (name, subject, body, type)
select
  'Follow-up reminder',
  'Following up',
  E'Hi {{contact_name}},\n\nJust a quick follow-up on my last email - I wanted to make sure it did not get buried.\n\nIf now is not a good time, no problem at all. If you have any questions, just reply here and I will be happy to help.\n\nThanks,\n{{agent_name}}',
  'follow_up'
where not exists (select 1 from public.email_templates where type = 'follow_up');

-- "Replied" = anything inbound after our last email: an email reply, an
-- inbound SMS, or an answered call. follow_up_count = follow-ups already sent
-- in the current unanswered run (outbound emails since the last reply, minus
-- the first one), so a reply resets the sequence and the next follow-up is
-- number follow_up_count + 1.
--
-- follow_up_due here uses the calendar-day default (3). The app derives the
-- flag itself from the raw columns using lib/follow-up/config.ts so the
-- threshold and the business-days switch live in one place.
--
-- security_invoker: the view runs with the caller's RLS, so an agent only
-- ever sees rows for leads assigned to them.
create or replace view public.leads_with_followup
with (security_invoker = true) as
with ev as (
  select
    lead_id,
    max(occurred_at) filter (
      where channel = 'email' and direction = 'outbound' and status not in ('failed', 'pending')
    ) as last_outbound_email_at,
    max(coalesce(received_at, occurred_at)) filter (
      where channel = 'email' and direction = 'inbound'
    ) as last_inbound_email_at,
    max(occurred_at) filter (
      where channel = 'sms' and direction = 'inbound'
    ) as last_inbound_sms_at,
    max(occurred_at) filter (
      where channel = 'call' and status = 'answered'
    ) as last_answered_call_at
  from public.outreach_events
  where lead_id is not null
  group by lead_id
),
lv as (
  select
    l.id as lead_id,
    l.stage,
    l.assigned_agent_id,
    l.follow_up_snoozed_until,
    ev.last_outbound_email_at,
    ev.last_inbound_email_at,
    ev.last_inbound_sms_at,
    ev.last_answered_call_at,
    greatest(ev.last_inbound_email_at, ev.last_inbound_sms_at, ev.last_answered_call_at) as last_reply_at
  from public.leads l
  join ev on ev.lead_id = l.id
  where ev.last_outbound_email_at is not null
)
select
  lv.lead_id,
  lv.stage,
  lv.assigned_agent_id,
  lv.follow_up_snoozed_until,
  lv.last_outbound_email_at,
  lv.last_inbound_email_at,
  lv.last_inbound_sms_at,
  lv.last_answered_call_at,
  lv.last_reply_at,
  floor(extract(epoch from (now() - lv.last_outbound_email_at)) / 86400)::int as days_since_last_email,
  coalesce(lv.last_reply_at > lv.last_outbound_email_at, false) as replied,
  greatest(0, (
    select count(*) from public.outreach_events o
    where o.lead_id = lv.lead_id
      and o.channel = 'email' and o.direction = 'outbound'
      and o.status not in ('failed', 'pending')
      and (lv.last_reply_at is null or o.occurred_at > lv.last_reply_at)
  ) - 1)::int as follow_up_count,
  (
    not coalesce(lv.last_reply_at > lv.last_outbound_email_at, false)
    and now() - lv.last_outbound_email_at >= interval '3 days'
    and lv.stage not in ('converted', 'dead')
    and (lv.follow_up_snoozed_until is null or lv.follow_up_snoozed_until <= now())
  ) as follow_up_due
from lv;

revoke all on public.leads_with_followup from anon;
grant select on public.leads_with_followup to authenticated;
