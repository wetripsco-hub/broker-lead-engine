-- SMS permission (TCPA): when a person agrees on a call to be texted ("Trial link sent" /
-- "Marketplace link sent"), the date and source are recorded on the lead. Agents may only text
-- leads that have this (or that texted us first); admins are not limited by it.
alter table public.leads
  add column if not exists sms_consent_at timestamptz,
  add column if not exists sms_consent_source text;

-- Same guard pattern as the AI-call consent: a signed-in non-admin cannot edit SMS consent
-- straight through the API. The app records it server-side (service role), which is trusted
-- because it has no signed-in user.
create or replace function public.guard_lead_calling_flags()
returns trigger language plpgsql as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;
  if new.ai_call_consent is distinct from old.ai_call_consent
     or new.ai_call_consent_source is distinct from old.ai_call_consent_source
     or new.ai_call_consent_at is distinct from old.ai_call_consent_at then
    raise exception 'Only an admin can change AI-call consent';
  end if;
  if new.sms_consent_at is distinct from old.sms_consent_at
     or new.sms_consent_source is distinct from old.sms_consent_source then
    raise exception 'SMS consent is recorded by the app, not edited directly';
  end if;
  if old.do_not_call and not new.do_not_call then
    raise exception 'Only an admin can clear do-not-call';
  end if;
  return new;
end;
$$;
