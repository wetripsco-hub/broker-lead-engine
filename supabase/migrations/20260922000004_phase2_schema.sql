-- ============================================================
-- Phase 2: ingestion_run_id on brokers + auto-lead trigger
-- ============================================================

-- Link each broker row to the ingestion run that created it
alter table public.brokers
  add column if not exists ingestion_run_id uuid references public.daily_ingestion_log(id) on delete set null;

create index if not exists brokers_ingestion_run_id_idx
  on public.brokers (ingestion_run_id);

-- ============================================================
-- Auto-create a 'new' lead whenever a broker is inserted
-- ============================================================
create or replace function public.create_lead_for_new_broker()
returns trigger language plpgsql security definer as $$
begin
  insert into public.leads (broker_id, stage)
  values (new.id, 'new')
  on conflict do nothing;
  return new;
end;
$$;

create trigger on_broker_inserted
  after insert on public.brokers
  for each row execute function public.create_lead_for_new_broker();
