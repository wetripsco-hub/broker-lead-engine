-- Agent call rules + Company page.
--   after_hours_requests: an agent asks the admin to allow one call outside
--                         calling hours; the admin grants or denies it.
--   company_info:         the Company page text (markdown), edited by the admin.
-- Status changes on requests happen in server actions only (service role).
-- Run in the Supabase SQL Editor. Safe to re-run.

-- ============================================================
-- after_hours_requests
-- ============================================================
create table if not exists public.after_hours_requests (
  id             uuid primary key default gen_random_uuid(),
  agent_id       uuid not null references public.agents(id) on delete cascade,
  lead_id        uuid not null references public.leads(id) on delete cascade,
  note           text not null check (length(btrim(note)) > 0),
  status         text not null default 'pending'
                 check (status in ('pending', 'granted', 'denied', 'used', 'expired')),
  requested_at   timestamptz not null default now(),
  decided_at     timestamptz,
  decided_by     uuid,
  deny_reason    text,
  expires_at     timestamptz,
  used_at        timestamptz,
  used_event_id  uuid
);

-- At most one open request per agent + lead.
create unique index if not exists after_hours_requests_one_pending
  on public.after_hours_requests (agent_id, lead_id)
  where status = 'pending';

create index if not exists after_hours_requests_agent_lead_idx
  on public.after_hours_requests (agent_id, lead_id, requested_at desc);

create index if not exists after_hours_requests_status_idx
  on public.after_hours_requests (status, requested_at desc);

alter table public.after_hours_requests enable row level security;

drop policy if exists "after_hours_requests_select" on public.after_hours_requests;
drop policy if exists "after_hours_requests_insert" on public.after_hours_requests;
drop policy if exists "after_hours_requests_update" on public.after_hours_requests;

-- Agents: own rows. Admin: everything.
create policy "after_hours_requests_select" on public.after_hours_requests
  for select using (public.is_admin() or agent_id = public.current_agent_id());

-- Agents: own pending rows, only for leads assigned to them.
create policy "after_hours_requests_insert" on public.after_hours_requests
  for insert with check (
    agent_id = public.current_agent_id()
    and status = 'pending'
    and lead_id in (select id from public.leads where assigned_agent_id = public.current_agent_id())
  );

create policy "after_hours_requests_update" on public.after_hours_requests
  for update using (public.is_admin());

-- ============================================================
-- company_info (single row, id = 1)
-- ============================================================
create table if not exists public.company_info (
  id          int primary key default 1 check (id = 1),
  body        text not null default '',
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

alter table public.company_info enable row level security;

drop policy if exists "company_info_select" on public.company_info;
drop policy if exists "company_info_insert" on public.company_info;
drop policy if exists "company_info_update" on public.company_info;

create policy "company_info_select" on public.company_info
  for select using (auth.uid() is not null);
create policy "company_info_insert" on public.company_info
  for insert with check (public.is_admin());
create policy "company_info_update" on public.company_info
  for update using (public.is_admin());

-- Seed (Appendix A of doc/AGENT_PRIVACY_COOLDOWN_COMPANY_RUNBOOK.md). Never
-- overwrites text the admin has already edited.
insert into public.company_info (id, body) values (1, $seed$# About Loadlinkers

Loadlinkers (loadlinkers.co) builds software and services for **newly authorized US freight brokers**.
We call brokers whose authority went active recently and offer two things:

1. **Loadlinkers TMS** — software to run their brokerage (main offer).
2. **Loadlinkers Marketplace** — free introductions to freight agents and dispatchers (backup offer).

---

## Who we call and why

New brokers usually run loads and rate confirmations on **spreadsheets**. That costs hours every week and causes
billing mistakes. Our job on the call is to find that pain and offer a better way.

**Goal of every call**
- Main: get permission to **text the 7-day free trial link**, or book a **15-minute demo**.
- Backup: a free **Marketplace** signup.
- Only text after the broker says "sure / okay". Then save the outcome **Trial link sent** or **Marketplace link sent**.

**Your calling rules**
- Calling hours: **Monday–Friday, 8 AM–6 PM in the broker's local time.** Need to call outside that? Send an
  after-hours request with a note; the admin approves it for one call.
- Maximum **40 calls per hour**.
- After **2 unanswered tries** on a broker, wait **1 hour** before trying again.

---

## Loadlinkers TMS — what to say

- Rate cons, FMCSA carrier checks and invoices **in one place**.
- **We import their spreadsheet for free.**
- **7-day free trial**, then **from $69/month**.
- Built to be **simpler** than big systems (e.g. Ascend), with free data import.

### What a TMS is (in simple words)
A Transportation Management System is the software a broker uses to run every load: create the load, find and check a
carrier, send the rate confirmation, track the truck, invoice the shipper and pay the carrier.

### Full feature list (from the product manual)
- **Loads:** load wizard with live margin and margin %; duplicate repeat lanes; import from a rate confirmation;
  status tracking from quoted → settled; Kanban board or table view.
- **Load boards:** post to **DAT** and **Truckstop** from inside the TMS, using the broker's own accounts.
- **Carrier vetting:** one profile per carrier (DOT, MC, authority, insurance, safety rating, W-9, COI);
  green / amber / red badges; carriers with inactive authority or expired insurance **cannot be assigned**;
  insurance expiry alerts.
- **Documents (OCR):** photo of a POD, BOL, carrier invoice or receipt → fields filled automatically, with a review queue.
- **Billing:** shipper invoices and carrier settlements from the load; **3-way match** (carrier pay, POD, carrier invoice)
  before paying; branded rate con and invoice PDFs; **QuickBooks Online** sync.
- **Tracking:** drivers get a link, no app needed; geofencing updates status; shippers get a read-only tracking page.
- **Dashboard:** margin month-to-date, top customers, unbilled delivered loads, expiring insurance.
- **Security:** each company's data is separated; full audit trail; roles (admin, agent, accountant, viewer);
  the broker's own DAT/Truckstop/QuickBooks keys, encrypted.

---

## Loadlinkers Marketplace — what to say

- We **personally connect brokers with freight agents and dispatchers.**
- The broker signs up with what they need (for example, an agent with their own shippers, or a dispatcher).
- **Profiles stay private** until we make a match; then we introduce both sides.
- **Free to join.** Link: loadlinkers.co/marketplace

---

## Common questions

**"What's the price?"** — From $69 a month, with a 7-day free trial so they can try real loads first.
**"We already have software."** — Ask which one and what they'd change; offer the trial to compare.
**"Send me an email."** — Ask what would be useful (pricing or a short video) and offer a 15-minute look on a set day.
**"Not interested."** — Ask if it's because they're set with a system or it's not the right time; offer the Marketplace.

## Rules
- Say at the start of every call: "This call may be recorded for quality."
- Never promise a feature you're not sure about — say "let me confirm that and get back to you".
- If someone asks not to be called, save **Do not call**.
$seed$)
on conflict (id) do nothing;
