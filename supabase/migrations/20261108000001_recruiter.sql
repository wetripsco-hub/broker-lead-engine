-- Recruiter tab (admin only): recruiting sales agents by email.
-- Completely separate from broker leads / email_templates / outreach_events.
-- Candidate videos and attachments are NEVER stored here or in Storage:
-- recruit_media keeps only metadata (where the file lives: a link, or an
-- IMAP uid + MIME part in the info@ mailbox).

-- ── recruits ────────────────────────────────────────────────────────────────
create table if not exists public.recruits (
  id                uuid primary key default gen_random_uuid(),
  name              text not null default '',
  email             text not null,
  source            text,
  stage             text not null default 'new'
                    check (stage in ('new','emailed','replied','video_received','interview','hired','rejected')),
  notes             text,
  unread            boolean not null default false,
  last_emailed_at   timestamptz,
  last_reply_at     timestamptz,
  follow_up_due_at  timestamptz,
  agent_id          uuid references public.agents(id) on delete set null,
  created_at        timestamptz not null default now(),
  constraint recruits_email_lower check (email = lower(email))
);
create unique index if not exists recruits_email_key on public.recruits (email);
create index if not exists recruits_stage_idx on public.recruits (stage);

-- ── recruit_templates (not the broker email_templates) ──────────────────────
create table if not exists public.recruit_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  subject     text not null,
  body        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger recruit_templates_updated_at
  before update on public.recruit_templates
  for each row execute function public.set_updated_at();

-- ── recruit_messages ────────────────────────────────────────────────────────
create table if not exists public.recruit_messages (
  id           uuid primary key default gen_random_uuid(),
  recruit_id   uuid not null references public.recruits(id) on delete cascade,
  direction    text not null check (direction in ('outbound','inbound')),
  subject      text,
  body_text    text,
  body_html    text,
  message_id   text,
  in_reply_to  text,
  references_header text,
  imap_uid     bigint,
  sent_at      timestamptz,
  received_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists recruit_messages_recruit_idx on public.recruit_messages (recruit_id, created_at);
create unique index if not exists recruit_messages_message_id_key on public.recruit_messages (message_id) where message_id is not null;

-- ── recruit_media (metadata only) ───────────────────────────────────────────
create table if not exists public.recruit_media (
  id            uuid primary key default gen_random_uuid(),
  recruit_id    uuid not null references public.recruits(id) on delete cascade,
  message_id    uuid not null references public.recruit_messages(id) on delete cascade,
  source_type   text not null check (source_type in ('attachment','link')),
  provider      text not null check (provider in ('attachment','gdrive','dropbox','onedrive','wetransfer','icloud','youtube','loom','vimeo','direct','unknown')),
  original_url  text,
  embed_url     text,
  file_name     text,
  mime_type     text,
  size_bytes    bigint,
  -- Exact decoded size, worked out the first time the file is streamed (for HTTP Range).
  decoded_size  bigint,
  imap_uid      bigint,
  imap_mailbox  text,
  mime_part_id  text,
  status        text not null check (status in ('available','embedded','link','skipped')),
  created_at    timestamptz not null default now()
);
create index if not exists recruit_media_message_idx on public.recruit_media (message_id);
create index if not exists recruit_media_recruit_idx on public.recruit_media (recruit_id);

-- ── recruit_send_queue (throttled sending) ──────────────────────────────────
create table if not exists public.recruit_send_queue (
  id           uuid primary key default gen_random_uuid(),
  batch_id     uuid not null,
  recruit_id   uuid not null references public.recruits(id) on delete cascade,
  template_id  uuid references public.recruit_templates(id) on delete set null,
  subject      text not null,
  body         text not null,
  status       text not null default 'queued' check (status in ('queued','sending','sent','failed','cancelled')),
  error        text,
  attempts     integer not null default 0,
  created_at   timestamptz not null default now(),
  claimed_at   timestamptz,
  sent_at      timestamptz
);
create index if not exists recruit_send_queue_status_idx on public.recruit_send_queue (status, created_at);
create index if not exists recruit_send_queue_claimed_idx on public.recruit_send_queue (claimed_at);

-- ── RLS: admin only on every table ──────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['recruits','recruit_templates','recruit_messages','recruit_media','recruit_send_queue'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
      t || '_admin_all', t);
  end loop;
end $$;

-- ── Claim the next email to send, respecting spacing and the hourly cap ─────
-- Serialised with an advisory lock so two runners never send at once.
create or replace function public.recruit_claim_send(p_interval_seconds integer, p_max_per_hour integer)
returns setof public.recruit_send_queue
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_last  timestamptz;
  v_count integer;
  v_row   public.recruit_send_queue;
begin
  perform pg_advisory_xact_lock(hashtext('recruit_send_queue'));

  -- A runner that died mid-send: we can't know if the mail went out, so it is
  -- marked failed (admin can retry) instead of silently sending a duplicate.
  update public.recruit_send_queue
     set status = 'failed', error = 'Interrupted while sending. Retry if the candidate did not get it.'
   where status = 'sending' and claimed_at < now() - interval '5 minutes';

  select max(claimed_at) into v_last from public.recruit_send_queue where claimed_at > now() - interval '1 hour';
  if v_last is not null and v_last > now() - make_interval(secs => p_interval_seconds) then
    return;
  end if;

  select count(*) into v_count from public.recruit_send_queue
   where claimed_at > now() - interval '1 hour' and status in ('sending','sent');
  if v_count >= p_max_per_hour then
    return;
  end if;

  update public.recruit_send_queue q
     set status = 'sending', claimed_at = now(), attempts = q.attempts + 1
   where q.id = (select id from public.recruit_send_queue where status = 'queued' order by created_at, id limit 1)
  returning q.* into v_row;
  if found then
    return next v_row;
  end if;
end;
$$;

revoke execute on function public.recruit_claim_send(integer, integer) from public, anon, authenticated;
grant execute on function public.recruit_claim_send(integer, integer) to service_role;
