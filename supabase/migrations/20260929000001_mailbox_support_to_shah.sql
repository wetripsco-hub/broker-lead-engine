-- Mailbox move: support@loadlinkers.co  ->  shah@loadlinkers.co
--
-- Run in the Supabase SQL Editor, in TWO steps (the editor only shows the
-- result of the LAST statement, so the check is kept separate):
--   STEP 1: run ONLY the "STEP 1" query below and look at the counts.
--   STEP 2: run the "STEP 2" block (everything after it).
--
-- Deliberately NOT touched: outreach_events (from_email / to_email there are
-- history of what was actually sent and received), and old migration files.

-- ============================================================================
-- STEP 1 — how many rows would change (run this alone first)
-- ============================================================================
select t.label,
       case
         when to_regclass('public.' || t.tbl) is null then null  -- table not created yet
         else (xpath('/row/c/text()', query_to_xml(t.q, false, true, '')))[1]::text::int
       end as rows_affected
from (values
  ('email_templates (rows to update)', 'email_templates',
   $q$select count(*) as c from public.email_templates
      where subject ~* 'support@loadlinkers\.co' or body ~* 'support@loadlinkers\.co'$q$),
  ('knowledge_base (rows to update)', 'knowledge_base',
   $q$select count(*) as c from public.knowledge_base
      where title ~* 'support@loadlinkers\.co' or content ~* 'support@loadlinkers\.co'$q$),
  ('app_settings (rows to update)', 'app_settings',
   $q$select count(*) as c from public.app_settings
      where value::text ~* 'support@loadlinkers\.co'$q$),
  ('email_sync_state (rows to delete)', 'email_sync_state',
   $q$select count(*) as c from public.email_sync_state$q$)
) as t(label, tbl, q);

-- ============================================================================
-- STEP 2 — apply (run after checking STEP 1)
-- ============================================================================
do $$
declare
  n integer;
begin
  -- Message templates: subject and body.
  update public.email_templates
  set subject = regexp_replace(subject, 'support@loadlinkers\.co', 'shah@loadlinkers.co', 'gi'),
      body    = regexp_replace(body,    'support@loadlinkers\.co', 'shah@loadlinkers.co', 'gi')
  where subject ~* 'support@loadlinkers\.co' or body ~* 'support@loadlinkers\.co';
  get diagnostics n = row_count;
  raise notice 'email_templates updated: %', n;

  -- Knowledge base and settings exist only if the Copilot migration was run.
  if to_regclass('public.knowledge_base') is not null then
    update public.knowledge_base
    set title   = regexp_replace(title,   'support@loadlinkers\.co', 'shah@loadlinkers.co', 'gi'),
        content = regexp_replace(content, 'support@loadlinkers\.co', 'shah@loadlinkers.co', 'gi')
    where title ~* 'support@loadlinkers\.co' or content ~* 'support@loadlinkers\.co';
    get diagnostics n = row_count;
    raise notice 'knowledge_base updated: %', n;
  end if;

  if to_regclass('public.app_settings') is not null then
    update public.app_settings
    set value = regexp_replace(value::text, 'support@loadlinkers\.co', 'shah@loadlinkers.co', 'gi')::jsonb
    where value::text ~* 'support@loadlinkers\.co';
    get diagnostics n = row_count;
    raise notice 'app_settings updated: %', n;
  end if;

  -- New mailbox = new UID space. Deleting the cursor makes the next sync
  -- "baseline" itself: it records the mailbox's current latest UID and imports
  -- nothing old, then reads only mail that arrives afterwards.
  delete from public.email_sync_state where id = 'inbox';
  get diagnostics n = row_count;
  raise notice 'email_sync_state rows reset: %', n;
end $$;

-- Verify (shows the final state; expect 0 everywhere except the cursor):
select
  (select count(*) from public.email_templates
     where subject ~* 'support@loadlinkers\.co' or body ~* 'support@loadlinkers\.co') as templates_still_old,
  (select count(*) from public.email_sync_state) as sync_state_rows;
