-- Where each agent wants commission paid: bank transfer (IBAN / account number, SWIFT),
-- Wise, Payoneer, PayPal or other. One row per agent. The agent writes their own row;
-- admins read every row (Payouts page). Nobody else can see it.
create table if not exists public.agent_payout_details (
  agent_id uuid primary key references public.agents(id) on delete cascade,
  method text not null check (method in ('bank', 'wise', 'payoneer', 'paypal', 'other')),
  account_holder text not null,
  country text not null,
  bank_name text,
  bank_country text,
  iban text,
  account_number text,
  swift_bic text,
  branch_or_routing text,
  payment_email text,
  address text,
  notes text,
  updated_at timestamptz not null default now()
);

alter table public.agent_payout_details enable row level security;
revoke all on public.agent_payout_details from anon;

create policy payout_details_select on public.agent_payout_details for select to authenticated
  using (public.is_admin() or agent_id in (select id from public.agents where user_id = auth.uid()));
create policy payout_details_insert on public.agent_payout_details for insert to authenticated
  with check (agent_id in (select id from public.agents where user_id = auth.uid()));
create policy payout_details_update on public.agent_payout_details for update to authenticated
  using (agent_id in (select id from public.agents where user_id = auth.uid()))
  with check (agent_id in (select id from public.agents where user_id = auth.uid()));

drop trigger if exists agent_payout_details_updated_at on public.agent_payout_details;
create trigger agent_payout_details_updated_at before update on public.agent_payout_details
  for each row execute function public.set_updated_at();
