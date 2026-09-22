-- Enable UUID generation
create extension if not exists "pgcrypto";

-- ============================================================
-- agents
-- ============================================================
create table public.agents (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  twilio_identity text,
  commission_rate numeric(5,4),          -- nullable; future add-on
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint agents_user_id_key unique (user_id)
);

alter table public.agents enable row level security;

-- ============================================================
-- brokers
-- ============================================================
create table public.brokers (
  id              uuid primary key default gen_random_uuid(),
  mc_number       text not null,
  dot_number      text,
  company_name    text not null,
  contact_name    text,
  email           text,
  phone           text,
  address_line1   text,
  address_line2   text,
  city            text,
  state           text,
  zip             text,
  authority_status text,
  registration_date date,
  first_seen_at   timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint brokers_mc_number_key unique (mc_number)
);

create index brokers_mc_number_idx on public.brokers (mc_number);
create index brokers_registration_date_idx on public.brokers (registration_date desc);

alter table public.brokers enable row level security;

-- ============================================================
-- daily_ingestion_log
-- ============================================================
create table public.daily_ingestion_log (
  id            uuid primary key default gen_random_uuid(),
  run_date      date not null,
  fetched_count integer not null default 0,
  new_count     integer not null default 0,
  updated_count integer not null default 0,
  status        text not null check (status in ('running','success','error')),
  error_message text,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz
);

create index ingestion_log_run_date_idx on public.daily_ingestion_log (run_date desc);

alter table public.daily_ingestion_log enable row level security;

-- ============================================================
-- leads
-- ============================================================
create type public.lead_stage as enum (
  'new', 'contacted', 'interested', 'converted', 'dead'
);

create table public.leads (
  id                uuid primary key default gen_random_uuid(),
  broker_id         uuid not null references public.brokers(id) on delete cascade,
  stage             public.lead_stage not null default 'new',
  assigned_agent_id uuid references public.agents(id) on delete set null,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index leads_assigned_agent_id_idx on public.leads (assigned_agent_id);
create index leads_stage_idx on public.leads (stage);
create index leads_broker_id_idx on public.leads (broker_id);

alter table public.leads enable row level security;

-- ============================================================
-- outreach_events
-- ============================================================
create type public.outreach_channel as enum ('email', 'call', 'sms');
create type public.outreach_status as enum (
  'pending', 'sent', 'delivered', 'failed', 'no_answer', 'answered'
);

create table public.outreach_events (
  id              uuid primary key default gen_random_uuid(),
  lead_id         uuid not null references public.leads(id) on delete cascade,
  agent_id        uuid not null references public.agents(id) on delete restrict,
  channel         public.outreach_channel not null,
  status          public.outreach_status not null default 'pending',
  message_body    text,
  recording_url   text,
  transcript      text,
  external_id     text,               -- Twilio SID or Resend message ID
  occurred_at     timestamptz not null default now()
);

create index outreach_events_lead_id_idx on public.outreach_events (lead_id, occurred_at desc);
create index outreach_events_agent_id_idx on public.outreach_events (agent_id);

alter table public.outreach_events enable row level security;

-- ============================================================
-- email_templates
-- ============================================================
create table public.email_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  subject     text not null,
  body        text not null,
  created_by  uuid references public.agents(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.email_templates enable row level security;

-- ============================================================
-- updated_at trigger helper
-- ============================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger brokers_updated_at
  before update on public.brokers
  for each row execute function public.set_updated_at();

create trigger leads_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

create trigger agents_updated_at
  before update on public.agents
  for each row execute function public.set_updated_at();

create trigger email_templates_updated_at
  before update on public.email_templates
  for each row execute function public.set_updated_at();
