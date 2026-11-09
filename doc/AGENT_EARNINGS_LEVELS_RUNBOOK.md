# Runbook — Agent earnings (recurring commission), levels, payouts, and "Learn your calling script"

Project: `broker-lead-engine` (Next.js on Vercel + Supabase `yqalyrelltibsjmrkatb`)

> Run `git pull` first. Read `AGENTS.md` and the relevant docs in `node_modules/next/dist/docs/` before writing code.

## Owner's decisions (follow exactly)

**Commission is recurring and only on money actually received.**
- A "sale" exists only when the customer's money is in the company account. Trials and promises are not sales.
- **Monthly plans:** every month the customer pays, the agent earns their level % of the **full amount received**
  (plan + extra seats + anything else on that payment). The month the customer stops paying, commission stops.
- **Yearly plans:** commission on the yearly payment is split: **50% in the next payout**, **50% six months later**,
  and the second half is paid **only if the customer is still active** at that time. Otherwise it is voided.
- If an **agent leaves** (deactivated), payments received after that date create **no** commission. Entries already
  pending or scheduled stay visible to the admin, who pays or voids each one by hand.
- **Payout day: the 15th of every month**, for money received in the previous month.
- No monthly targets. **No leaderboard** for now (will be designed later with real data).

**Levels are based on the agent's number of ACTIVE customers right now** (a customer counts while not cancelled).
Levels go up and down with active customers.

| Level | Active customers | Commission |
|---|---|---|
| Bronze | 0–9 | 30% |
| Silver | 10–24 | 35% |
| Gold | 25–49 | 40% |
| Platinum | 50+ | 40%, plus the option of **salary + commission** (terms agreed with the admin) |

- The rate used for a payment = the agent's level **at the moment the admin records that payment**, stored on the entry
  so later level changes never rewrite history. The admin can override the rate or amount on any entry (with a note).
- Platinum salary option: no amounts in the app. The admin can mark an agent as `salary + commission` and set a custom
  commission % for that agent; that custom % then replaces the level %.

**Admin portal stays as it is**; this adds new admin pages. All money values are USD.

---

## 1. Data (one migration)

All three tables: RLS on. Admin (`is_admin()`) full access. An agent can **select only their own rows**, never
insert/update/delete. Writes happen in server actions guarded by `isAdminInDb`.

```sql
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id),
  lead_id uuid references public.leads(id),            -- the broker lead the sale came from (optional)
  company_name text not null,
  plan text not null check (plan in ('starter','growth','scale','custom')),
  billing text not null check (billing in ('monthly','yearly')),
  status text not null default 'active' check (status in ('active','cancelled')),
  started_at date not null,
  cancelled_at date,
  notes text,
  created_at timestamptz not null default now()
);

create table public.customer_payments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  received_at date not null,                            -- the day the money arrived in the account
  amount_usd numeric(12,2) not null check (amount_usd > 0),
  covers text not null check (covers in ('month','year')),
  note text,
  created_at timestamptz not null default now()
);

create table public.commission_entries (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id),
  customer_id uuid not null references public.customers(id),
  payment_id uuid not null references public.customer_payments(id),
  kind text not null check (kind in ('monthly','yearly_first_half','yearly_second_half','adjustment')),
  level text not null,                                  -- level at the time (bronze/silver/gold/platinum/custom)
  rate numeric(5,4) not null,                           -- 0.30, 0.35, 0.40 ...
  base_usd numeric(12,2) not null,                      -- part of the payment this entry is based on
  amount_usd numeric(12,2) not null,
  payout_date date not null,                            -- always the 15th of a month
  status text not null default 'pending' check (status in ('pending','scheduled','paid','void')),
  paid_at timestamptz,
  paid_reference text,                                  -- e.g. Wise/Payoneer/bank reference
  note text,
  created_at timestamptz not null default now()
);
```

On `agents` add: `comp_type text not null default 'commission' check (comp_type in ('commission','salary_plus_commission'))`,
`custom_rate numeric(5,4)` (null = use level rate), `left_at timestamptz` (set when the admin deactivates an agent, if
there isn't an existing column for that already — reuse it if there is).

## 2. Rules as pure functions — `lib/commission.ts` (+ `scripts/_commission-tests.ts`)

```ts
LEVELS = [
  { id: "bronze",   min: 0,  rate: 0.30 },
  { id: "silver",   min: 10, rate: 0.35 },
  { id: "gold",     min: 25, rate: 0.40 },
  { id: "platinum", min: 50, rate: 0.40, salaryOption: true },
]
levelFor(activeCustomers) -> level
nextLevel(activeCustomers) -> { level, needed } | null      // "Silver: 3 more active customers"
rateFor(agent, activeCustomers) -> custom_rate ?? levelFor(...).rate
payoutDateFor(receivedAt) -> the 15th of the month after receivedAt
entriesForPayment(payment, customer, rate, level) ->
   monthly: one entry, amount = round2(amount * rate), status 'pending', payout = payoutDateFor(received_at)
   yearly : two entries, each base = amount / 2:
            first half  -> 'pending',   payout = payoutDateFor(received_at)
            second half -> 'scheduled', payout = the 15th, 6 months after the first half's payout date
summaryFor(entries, today) -> {
   nextPayoutDate, nextPayoutUsd,        // pending entries with the nearest payout date
   thisMonthEarnedUsd,                   // entries whose payment was received this calendar month (not void)
   paidTotalUsd, pendingUsd, scheduledUsd,
   totalSoFarUsd,                        // paid + pending (not scheduled, not void)
}
monthlyRecurringUsd(activeCustomers with their latest monthly amount, rate) -> "$X / month"
```

Money: round to cents with integer math (cents) to avoid float errors.

Tests must cover: level boundaries (9→Bronze, 10→Silver, 24→Silver, 25→Gold, 49→Gold, 50→Platinum); level going down
when customers cancel; monthly entry amount; yearly split and both payout dates (e.g. received 20 Nov 2026 → 15 Dec 2026
and 15 Jun 2027); custom rate overrides level; summary numbers.

## 3. Server logic

- **Record payment** (admin): inserts `customer_payments`, then — unless the agent has `left_at` before `received_at`, or
  the customer is cancelled — computes the agent's current active-customer count, the rate, and inserts the commission
  entries. One transaction (use an RPC / `security definer` function if needed).
- **Cancel customer** (admin): `status='cancelled'`, `cancelled_at`. Any `scheduled` yearly second half for that customer
  becomes `void` (note "customer left before 6 months").
- **Scheduled → pending:** when a `scheduled` entry's payout date is within the next 31 days and the customer is still
  active, show it as pending. Do this on read (no cron needed) or in the payout screen query.
- **Mark paid** (admin): select an agent + payout date → all their `pending` entries for that date → `paid`, `paid_at`,
  `paid_reference`.
- **Adjustment** (admin): manual entry with kind `adjustment` (can be negative) and a required note.
- Deactivating an agent sets `left_at`; nothing is deleted.

## 4. Admin pages (new, admin only, in the admin sidebar block)

1. **Customers** (`/customers`): table — company, agent, plan, billing, status, started, last payment, total received.
   Buttons: **Add customer** (agent, lead search, company name auto-filled from the lead, plan, billing, start date,
   first payment amount + date → creates customer + first payment + commission), **Record payment**, **Cancel**.
   Highlight monthly customers with no payment in the last 35 days ("payment overdue?") — display only, no auto-cancel.
2. **Payouts** (`/payouts`): grouped by payout date (15th), then by agent: amount, number of entries, entries list;
   **Mark paid** with a reference. Upcoming scheduled (yearly second halves) in a separate section.
3. **Agents page:** add per agent: level badge, active customers, this month earned, next payout, total so far; and an
   admin control for `comp_type` / `custom_rate` (Platinum salary option).

## 5. Agent "My earnings" at the top of the agent's home page

Agents only (the admin home stays as it is). Server-rendered from their own rows:

- **Level card:** badge (🥉 Bronze / 🥈 Silver / 🥇 Gold / 💎 Platinum), "N active customers", your commission %, and a
  progress bar: "Silver: 3 more active customers". Small note: "Your level follows your active customers."
- **Money cards (USD):** **Next payout** (date + amount) · **This month** · **Paid so far** · **Total so far**, plus
  **Monthly recurring: $X / month from N active customers** and **Scheduled** (yearly second halves, with dates).
- **Recurring calculator** (clearly labelled "Calculator"): agent picks plan (Starter $69 / Growth $189 / Scale $799) and
  number of customers → "N × $price × your rate = $X every month while they stay". Uses the agent's current rate.
- **Level roadmap:** the four levels with active-customer thresholds and %, Platinum showing "Option: salary + commission".
- **My earnings list:** date received, company, kind (monthly / yearly 1st half / yearly 2nd half), rate, amount,
  payout date, status (Pending / Scheduled / Paid / Void).
- **Learn your calling script** card → link to §6.

Never show other agents' numbers. No leaderboard.

## 6. "Learn your calling script" (agents and admin)

Page `/script` (sidebar item **Call script** for everyone), three tabs, all rendered from `lib/call-script/script.ts`
so the dialer panel and this page always show the same words:

| Tab | Sections of `CALL_SCRIPT` |
|---|---|
| **Quick call** | `short`, `voicemail` |
| **Normal** | `opener`, `yes`, `no`, `marketplace`, `marketplace-first`, `text`, `email` |
| **Demo / Detailed** | new section `demo` (Appendix A) |

- Add the `demo` section from Appendix A to `CALL_SCRIPT` exactly as written (same data shape), and append `"demo"` to
  `GUIDED_ORDER`, so it also appears in the in-call script panel.
- Show `SCRIPT_GOALS` and `CALLER_NOTES` at the top of every tab.
- Read-only; placeholders like `[Name]` stay as written on this page.

## 7. Test checklist

- [ ] `npm run build` + all `scripts/_*-tests.ts` pass (new commission tests included).
- [ ] Admin adds a monthly Growth customer for an agent with a $189 payment on 20 Nov → agent sees $56.70 pending,
      payout 15 Dec, Bronze 30%, "1 active customer", "Silver: 9 more".
- [ ] Yearly payment $1,814.40 on 20 Nov → two entries of $272.16: pending 15 Dec, scheduled 15 Jun.
      Cancel that customer in March → the June entry becomes void.
- [ ] 10 active customers → Silver; new payments use 35%; old entries keep their rate. Cancel one → back to Bronze.
- [ ] Mark paid on 15 Dec → agent sees it under Paid, Total so far unchanged, Next payout moves on.
- [ ] Agent deactivated → new payments for their customers create no commission.
- [ ] Agent cannot see another agent's customers/entries, cannot open `/customers` or `/payouts`, cannot write any of the
      three tables through the API.
- [ ] `/script` shows three tabs; the dialer's script panel includes the new Demo section.
- [ ] Admin home and all existing admin pages unchanged.

---

## Appendix A — `demo` section for `CALL_SCRIPT` (paste as-is)

```ts
{
  id: "demo",
  title: "Demo / Detailed (15-minute call)",
  hint: "Use when the broker is interested, booked a demo, or asks a lot of questions. Screen-share loadlinkers.co if you can.",
  items: [
    {
      id: "demo-open",
      title: "1. Open and set the agenda (1 min)",
      lines: [
        { kind: "say", text: "Hey [Name], it's [First Name] with Loadlinkers. Just so you know, this call may be recorded for quality. Thanks for making the time. Here's what I'd suggest: two minutes on how you run loads today, then I'll show you the three things brokers use most, and you tell me if it fits. Sound fair?" },
      ],
    },
    {
      id: "demo-discover",
      title: "2. Ask before you show (3 min)",
      lines: [
        { kind: "say", text: "How many loads are you running a week right now?" },
        { kind: "say", text: "Where do your rate cons, carrier checks and invoices live today: spreadsheets, email, something else?" },
        { kind: "say", text: "What takes the most time in a normal week?" },
        { kind: "say", text: "Is it just you, or do you have agents or a dispatcher working with you?" },
        { kind: "note", text: "Write the answers in the CRM notes. Show only the parts that match their pain. Team size decides the plan (Starter 1 user, Growth 3, Scale 10)." },
      ],
    },
    {
      id: "demo-show",
      title: "3. Show the three things (6 min)",
      lines: [
        { kind: "say", text: "First: you upload a signed rate confirmation and it fills in the carrier, rate and stops as a new load. No retyping." },
        { kind: "say", text: "Second: before you assign a carrier, it checks them against FMCSA and flags expired insurance, inactive authority or an unsatisfactory safety rating." },
        { kind: "say", text: "Third: on every load you see shipper rate, carrier pay and your margin side by side, and invoices come from the delivered load. Your customer can also get a tracking link, no app or login needed." },
        { kind: "say", text: "Which of those would save you the most time?" },
        { kind: "note", text: "Only talk about features on loadlinkers.co. If you're not sure something exists, say: \"Let me confirm that and get back to you.\"" },
      ],
    },
    {
      id: "demo-price",
      title: "4. Price and plan (2 min)",
      lines: [
        { kind: "say", text: "Plans are monthly: Starter is $69 for one user, Growth is $189 for three users with invoicing and lane and margin history, and Scale is $799 for ten users with QuickBooks Online and factoring. Extra seats are $25 a month, and paying yearly saves 20%." },
        { kind: "say", text: "From what you told me, [plan] fits best. And there's a 7-day free trial, no credit card." },
      ],
    },
    {
      id: "demo-close",
      title: "5. Close and next step (2 min)",
      lines: [
        { kind: "say", text: "Here's what I'd suggest: start the trial today, send me your current load sheet, and we'll import it for you for free, so you're working with your real lanes and carriers from day one. Would you be opposed to that?" },
        { kind: "them", text: "Okay, let's try it." },
        { kind: "say", text: "Great. I'll text you the trial link now. When's a good time on day 2 of the trial for a 10-minute check-in, so I can make sure the import looks right?" },
        { kind: "note", text: "Save \"Trial link sent\" (only text after they agreed) and put the check-in time in the notes." },
      ],
    },
    {
      id: "demo-obj-price",
      title: "\"It's too expensive.\"",
      lines: [
        { kind: "say", text: "Understood. Compared to what you're doing today, how many hours a week go into rate cons, carrier checks and invoices? … Starter is $69 a month for one user, and the trial is free, so you can see if it saves you more than that before paying anything." },
      ],
    },
    {
      id: "demo-obj-think",
      title: "\"I need to think about it.\"",
      lines: [
        { kind: "say", text: "Totally fair. What's the main thing you'd want to think through: price, switching your data, or whether it fits how you work? … The trial doesn't need a card, so you can think about it while you try it with a real load." },
      ],
    },
    {
      id: "demo-obj-partner",
      title: "\"I need to talk to my partner.\"",
      lines: [
        { kind: "say", text: "Makes sense. Would it help if we set up 15 minutes with both of you, so they can ask their own questions? What day works for you both?" },
      ],
    },
    {
      id: "demo-obj-switch",
      title: "\"Switching sounds like a lot of work.\"",
      lines: [
        { kind: "say", text: "That's why we do the import for you. Send us your spreadsheet and we move your loads in, free. You don't start from zero." },
      ],
    },
    {
      id: "demo-obj-dat",
      title: "\"Can it post to DAT or Truckstop?\"",
      lines: [
        { kind: "say", text: "Yes, DAT and Truckstop setup is available on request on the Growth and Scale plans, using your own accounts." },
      ],
    },
    {
      id: "demo-obj-qb",
      title: "\"Does it work with QuickBooks?\"",
      lines: [
        { kind: "say", text: "QuickBooks Online is included on the Scale plan." },
        { kind: "note", text: "If they need QuickBooks but only want Growth, don't promise anything: say you'll confirm with the team." },
      ],
    },
    {
      id: "demo-obj-data",
      title: "\"Is my data safe?\"",
      lines: [
        { kind: "say", text: "Each company's data is kept separate, every change is logged, and you control who on your team can see what with roles like admin, agent, accountant and read-only." },
      ],
    },
  ],
},
```

---

## Addendum (9 Nov 2026) — Per-agent terms and salary review

Migration `20261109000001_agent_terms.sql`, logic in `lib/agent-terms.ts`, tests `scripts/_agent-terms-tests.ts`.

- **Agent terms** (`agent_terms`, one row per agent, admin only): levels (name, %, active-customer threshold, "salary
  message" flag), salary review rule, offer label, effective date, notes. Edited from **Agents → Agent terms**.
- **Default template** (`commission_templates`, `is_default`): "Launch offer" Bronze 30% / Silver 35% at 10 / Gold 40% at
  25 / Platinum 40% at 50. Edited from **Agents → Default terms**. A trigger on `agents` insert copies it into the new
  agent's `agent_terms`. Editing the default never changes existing agents.
- **Active paying customer** = `customers.status = 'active'` AND at least one `customer_payments` row. Trials (no payment)
  don't count. Levels, rates and the salary rule all use this count. The plan (starter/growth/scale/custom) is on `customers.plan`.
- **Salary review** (admin only): active paying ≥ `min_active` AND Scale ≥ `min_scale` AND Growth ≥ `min_growth`
  (default 50/10/10). Meets it → "Salary review eligible" badge + the list at the top of Agents. 50+ without the mix
  stays on the flat level % (40%).
- **Agent view**: My Account → **My terms** (own levels, current level, active paying count, progress). Levels at a
  "salary message" level show "Eligible for a salary offer review, based on account mix". The agent reads only
  `my_agent_terms()` (levels, offer label, effective date) and never the rule or notes.
- The existing `custom_rate` / salary + commission pay terms still override the level %.
