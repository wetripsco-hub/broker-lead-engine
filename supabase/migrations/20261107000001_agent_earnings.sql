-- Agent earnings: customers, payments received, recurring commission entries
-- (doc/AGENT_EARNINGS_LEVELS_RUNBOOK.md §1). Safe to re-run.
--
-- RLS: admin full access; an agent can only SELECT their own rows. Writes go through
-- admin-only server actions (service role) and the two functions at the bottom,
-- which run each change as one transaction.

-- ── Tables ───────────────────────────────────────────────────────────────────
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id),
  lead_id uuid references public.leads(id),
  company_name text not null,
  plan text not null check (plan in ('starter','growth','scale','custom')),
  billing text not null check (billing in ('monthly','yearly')),
  status text not null default 'active' check (status in ('active','cancelled')),
  started_at date not null,
  cancelled_at date,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists customers_agent_id_idx on public.customers (agent_id);

create table if not exists public.customer_payments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  received_at date not null,
  amount_usd numeric(12,2) not null check (amount_usd > 0),
  covers text not null check (covers in ('month','year')),
  note text,
  created_at timestamptz not null default now()
);
create index if not exists customer_payments_customer_id_idx on public.customer_payments (customer_id);

create table if not exists public.commission_entries (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id),
  customer_id uuid not null references public.customers(id),
  payment_id uuid not null references public.customer_payments(id),
  kind text not null check (kind in ('monthly','yearly_first_half','yearly_second_half','adjustment')),
  level text not null,
  rate numeric(5,4) not null,
  base_usd numeric(12,2) not null,
  amount_usd numeric(12,2) not null,
  payout_date date not null check (extract(day from payout_date) = 15),
  status text not null default 'pending' check (status in ('pending','scheduled','paid','void')),
  paid_at timestamptz,
  paid_reference text,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists commission_entries_agent_id_idx on public.commission_entries (agent_id);
create index if not exists commission_entries_customer_id_idx on public.commission_entries (customer_id);
create index if not exists commission_entries_payout_idx on public.commission_entries (payout_date, status);

-- ── Agents: pay terms + when they left ──────────────────────────────────────
alter table public.agents add column if not exists comp_type text not null default 'commission';
alter table public.agents drop constraint if exists agents_comp_type_check;
alter table public.agents add constraint agents_comp_type_check check (comp_type in ('commission','salary_plus_commission'));
alter table public.agents add column if not exists custom_rate numeric(5,4);
alter table public.agents drop constraint if exists agents_custom_rate_check;
alter table public.agents add constraint agents_custom_rate_check check (custom_rate is null or (custom_rate >= 0 and custom_rate <= 1));
alter table public.agents add column if not exists left_at timestamptz;
-- Agents already disabled or archived before this migration count as having left.
update public.agents
   set left_at = coalesce(deleted_at, now())
 where (active = false or deleted_at is not null) and left_at is null;

-- Agents may update their own row (last_seen_at etc.), so stop them changing their pay terms.
create or replace function public.guard_agent_comp()
returns trigger language plpgsql as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;
  if new.comp_type is distinct from old.comp_type
     or new.custom_rate is distinct from old.custom_rate
     or new.left_at is distinct from old.left_at then
    raise exception 'Pay terms are set by the admin';
  end if;
  return new;
end;
$$;

drop trigger if exists agents_guard_comp on public.agents;
create trigger agents_guard_comp
  before update on public.agents
  for each row execute function public.guard_agent_comp();

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.customers enable row level security;
alter table public.customer_payments enable row level security;
alter table public.commission_entries enable row level security;

drop policy if exists "customers_select" on public.customers;
drop policy if exists "customers_admin_insert" on public.customers;
drop policy if exists "customers_admin_update" on public.customers;
drop policy if exists "customers_admin_delete" on public.customers;
create policy "customers_select" on public.customers
  for select using (public.is_admin() or agent_id = public.current_agent_id());
create policy "customers_admin_insert" on public.customers for insert with check (public.is_admin());
create policy "customers_admin_update" on public.customers for update using (public.is_admin());
create policy "customers_admin_delete" on public.customers for delete using (public.is_admin());

drop policy if exists "customer_payments_select" on public.customer_payments;
drop policy if exists "customer_payments_admin_insert" on public.customer_payments;
drop policy if exists "customer_payments_admin_update" on public.customer_payments;
drop policy if exists "customer_payments_admin_delete" on public.customer_payments;
create policy "customer_payments_select" on public.customer_payments
  for select using (
    public.is_admin()
    or customer_id in (select id from public.customers where agent_id = public.current_agent_id())
  );
create policy "customer_payments_admin_insert" on public.customer_payments for insert with check (public.is_admin());
create policy "customer_payments_admin_update" on public.customer_payments for update using (public.is_admin());
create policy "customer_payments_admin_delete" on public.customer_payments for delete using (public.is_admin());

drop policy if exists "commission_entries_select" on public.commission_entries;
drop policy if exists "commission_entries_admin_insert" on public.commission_entries;
drop policy if exists "commission_entries_admin_update" on public.commission_entries;
drop policy if exists "commission_entries_admin_delete" on public.commission_entries;
create policy "commission_entries_select" on public.commission_entries
  for select using (public.is_admin() or agent_id = public.current_agent_id());
create policy "commission_entries_admin_insert" on public.commission_entries for insert with check (public.is_admin());
create policy "commission_entries_admin_update" on public.commission_entries for update using (public.is_admin());
create policy "commission_entries_admin_delete" on public.commission_entries for delete using (public.is_admin());

-- ── Record a payment (optionally creating the customer) in one transaction ──
-- The commission rules live in lib/commission.ts; the server action passes the
-- computed entries in p_entries (amounts in cents). Service role only.
create or replace function public.record_customer_payment(
  p_customer_id uuid,
  p_new_customer jsonb,
  p_received_at date,
  p_amount_cents bigint,
  p_covers text,
  p_note text,
  p_entries jsonb
) returns jsonb
language plpgsql as $$
declare
  v_customer_id uuid := p_customer_id;
  v_agent_id uuid;
  v_payment_id uuid;
  e jsonb;
begin
  if v_customer_id is null then
    insert into public.customers (agent_id, lead_id, company_name, plan, billing, started_at, notes)
    values (
      (p_new_customer->>'agent_id')::uuid,
      nullif(p_new_customer->>'lead_id', '')::uuid,
      p_new_customer->>'company_name',
      p_new_customer->>'plan',
      p_new_customer->>'billing',
      (p_new_customer->>'started_at')::date,
      nullif(p_new_customer->>'notes', '')
    )
    returning id into v_customer_id;
  end if;

  select agent_id into v_agent_id from public.customers where id = v_customer_id;
  if v_agent_id is null then
    raise exception 'Customer not found';
  end if;

  insert into public.customer_payments (customer_id, received_at, amount_usd, covers, note)
  values (v_customer_id, p_received_at, p_amount_cents / 100.0, p_covers, nullif(p_note, ''))
  returning id into v_payment_id;

  for e in select * from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) loop
    insert into public.commission_entries
      (agent_id, customer_id, payment_id, kind, level, rate, base_usd, amount_usd, payout_date, status)
    values (
      v_agent_id, v_customer_id, v_payment_id,
      e->>'kind', e->>'level', (e->>'rate')::numeric,
      (e->>'base_cents')::bigint / 100.0, (e->>'amount_cents')::bigint / 100.0,
      (e->>'payout_date')::date, e->>'status'
    );
  end loop;

  return jsonb_build_object('customer_id', v_customer_id, 'payment_id', v_payment_id);
end;
$$;

-- ── Cancel a customer: stop counting them, void any scheduled yearly 2nd half ──
create or replace function public.cancel_customer(p_customer_id uuid, p_cancelled_at date)
returns integer
language plpgsql as $$
declare
  v_voided integer;
begin
  update public.customers
     set status = 'cancelled', cancelled_at = p_cancelled_at
   where id = p_customer_id and status = 'active';
  if not found then
    raise exception 'Customer not found or already cancelled';
  end if;

  update public.commission_entries
     set status = 'void', note = 'customer left before 6 months'
   where customer_id = p_customer_id
     and kind = 'yearly_second_half'
     and status = 'scheduled';
  get diagnostics v_voided = row_count;
  return v_voided;
end;
$$;

revoke all on function public.record_customer_payment(uuid, jsonb, date, bigint, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.cancel_customer(uuid, date) from public, anon, authenticated;
grant execute on function public.record_customer_payment(uuid, jsonb, date, bigint, text, text, jsonb) to service_role;
grant execute on function public.cancel_customer(uuid, date) to service_role;
