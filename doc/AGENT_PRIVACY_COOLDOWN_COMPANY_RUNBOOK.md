# Runbook — Agent restrictions: hidden contact info, calling hours, hourly limit, broker cooldown, AI calls admin-only, Knowledge admin-only, Company page

Project: `broker-lead-engine` (Next.js + Supabase `yqalyrelltibsjmrkatb` + Telnyx WebRTC)

> Read `AGENTS.md` first — this repo uses a newer Next.js; check `node_modules/next/dist/docs/` before writing code.

## Owner's decisions (follow exactly, do not go beyond them)

- **Every restriction in this runbook applies to agents only** (`role = agent`). The admin account (the wetrips.co one,
  `isAdminInDb` = true) must work **exactly as today**: same pages, same buttons, same AI calling, no masking, no
  calling-hours block, no hourly limit, no broker cooldown, no new confirmation steps. The only admin-side additions are
  the new **Requests** page (§3) and the editable **Company** page (§7).
- Contact info is hidden **on screen only**. Do NOT change Telnyx, the dialer's calling mechanism, RLS or column grants
  for brokers. The dialer may still receive the real number internally to place the call — it just must not be displayed.
- Do NOT change SMS permission rules, call recording, or the AI-call provider code / AI calling gate.
- Agents may log in at any time. Only **calling** is restricted.
- Every agent restriction is enforced **on the server** (in the server action that starts a call), not just in the UI.

Use one server-side helper for the role: `const isAdmin = await isAdminInDb(admin, user.id)`. Never trust a role sent by
the client.

---

## 1. AI calls → admin only

- Agents must not see anything AI-call related: `components/leads/ai-call-controls.tsx` on the lead page, the AI call
  queue UI, `/settings/ai-calling`, and the "AI call" column/badges in the leads list (`aiCall` column in
  `leads-list-client.tsx`). Render them only when `isAdmin`.
- Server: `app/api/ai-calls/start/route.ts` and any other AI-call/queue route or action must return 403
  "AI calls are admin only" for non-admins. Pages under `/settings/ai-calling` redirect non-admins to `/leads`.
- Admin: no change at all (keep the existing AI calling gate, hours, caps and override exactly as they are).

## 2. Mask broker phone numbers and emails for agents

### 2.1 Helpers — `lib/mask.ts` (+ tests in `scripts/_mask-tests.ts`)

```ts
maskPhone("+13125550147") -> "(312) •••-••47"   // keep area code (local-time feature uses it) + last 2 digits
maskEmail("john.smith@acmelogistics.com") -> "j•••@a•••.com"
maskPhone(null) -> null ; maskEmail(null) -> null ; invalid input -> "•••"
```

### 2.2 Rule

In every server component / server action that sends broker contact data to the browser, pass masked strings when
`!isAdmin`. Never rely on CSS blur. The dialer still needs the real number to dial: pass it as a separate prop (e.g.
`dialNumber`) used only for `newCall({ destinationNumber })`, and use the masked string for anything rendered.

### 2.3 Places to change (found by grep; search again for any you miss: `phone`, `email`, `telephone`, `from_email`, `to_email`, `from_number`, `to_number`, `formatPhoneDisplay(`, `mailto:`, `tel:`)

| File | What is shown today |
|---|---|
| `app/(dashboard)/leads/[id]/page.tsx` | Phone + Email `InfoRow`s (~L375–377); company officers' `telephone` + `email` with `mailto:` links (~L422–430); props `brokerPhone` / `brokerEmail` passed to children |
| `components/leads/dialer-modal.tsx` | number under the broker name (~L437) |
| `components/leads/call-button.tsx` | error text quoting the raw number (`"… is not a valid phone number"`) |
| `components/leads/sms-thread.tsx` | number in the header (~L141) |
| `components/leads/email-compose.tsx` | "To" address (~L102) |
| `components/leads/outreach-timeline.tsx` | `from_email` of inbound emails |
| `components/leads/bulk-email-modal.tsx` | recipient emails, if listed |
| `app/(dashboard)/leads/page.tsx` + `leads-list-client.tsx` | `brokers.phone/email` sent to the client (used for timezone + bulk email) — send masked values; for timezone send `state` and area code only |
| `components/leads/local-time-card.tsx` | receives `phone` — give it the area code / masked value only |
| `app/(dashboard)/emails/*` | counterparty email in list + "from" line (~L71, ~L532) |
| `app/(dashboard)/messages/*` | counterparty number (~L41), `brokers.phone` |

- Remove `mailto:` / `tel:` links and any "copy" buttons on contact data for agents.
- Sending must still work without the agent seeing the address: email/SMS server actions look up the recipient from the
  lead id on the server. If any action takes the address/number from the client, change it to read from the DB.
- `/calls` and CSV export are admin-only already — leave them unmasked. Call-script `[number]` is OUR callback number — leave it.

## 3. Calling hours for agents + after-hours request to admin

### 3.1 Window

Agents may place manual calls only **Monday–Friday, 8:00 AM–6:00 PM in the broker's local time**. Reuse the window logic
of the AI gate (`resolveTimezone` + `getCallStatus`, including the ±1 hour probes for approximate time zones) by moving
it into a shared function — without changing the AI gate's behaviour. `closing` counts as inside the window.
Outside the window, on weekends, **or when the broker's time zone can't be worked out**, the agent needs an approved
request.

For agents, replace today's "call anyway?" confirmation in `components/leads/call-button.tsx` with the request flow below.
For admins, keep `call-button.tsx` behaviour exactly as it is today.

### 3.2 Data

Migration: table `after_hours_requests`:
`id uuid pk, agent_id uuid → agents, lead_id uuid → leads, note text not null, status text check in
('pending','granted','denied','used','expired') default 'pending', requested_at timestamptz default now(),
decided_at timestamptz, decided_by uuid, deny_reason text, expires_at timestamptz, used_at timestamptz, used_event_id uuid`.
RLS: an agent can select/insert only their own rows (for leads assigned to them); admin can select/update all. Status
changes happen in server actions only. At most one `pending` request per agent + lead (partial unique index).

### 3.3 Agent side

- Outside the window the Call button is replaced with: "Outside calling hours (broker's time: 7:42 PM Tue)" and a
  **Request after-hours call** button that opens a dialog with a required note ("Why do you need to call now?").
- States shown on the lead page: *Pending — waiting for admin*, *Denied (reason)*, *Approved — call within MM:SS*
  (Call button enabled), *Expired*.
- Refresh the state every ~15 s while pending (or use the same mechanism as `UnreadSmsBadge`).

### 3.4 Admin side

- New page **Requests** (`/requests`, admin only) in the admin sidebar block with a badge for the number of pending
  requests (same pattern as `UnreadSmsBadge`). Each row: agent name, company + MC (link to the lead), the note, broker's
  local time now, requested time; buttons **Grant** and **Deny** (optional reason). Also show the last 50 decided requests.
- Grant sets `status = granted`, `decided_at`, `decided_by`, `expires_at = now() + 30 min`.

### 3.5 Server enforcement — in `logCallStarted()` (`app/(dashboard)/leads/[id]/call-actions.ts`)

For agents only, after the existing do-not-call check and **before** inserting the call row:

1. If outside the window → require a row for this agent + lead with `status = 'granted' and expires_at > now()`. If none →
   return `{ error: "Outside calling hours. Send an after-hours request to the admin.", blocked: true }`.
2. Hourly limit check (§4) and broker cooldown check (§5). If either blocks, return its message and do **not** use the grant.
3. Only when the call is allowed, consume the grant atomically:
   `update … set status='used', used_at=now(), used_event_id=<new event id> where id=… and status='granted' and expires_at>now() returning id`.
   One grant = one call. The next after-hours call needs a new request.
4. Mark grants past `expires_at` as `expired` (on read is fine; no cron needed).

## 4. Hourly call limit for agents: 40 calls per rolling hour

- Pure function in `lib/agent-hourly-limit.ts` (+ tests `scripts/_agent-hourly-limit-tests.ts`), constant
  `HOURLY_CALL_LIMIT = 40`.
- Count the agent's own manual call attempts (`outreach_events`, `channel = 'call'`, `direction = 'outbound'`,
  `agent_id` = this agent) in the last 60 minutes, answered or not.
- If count ≥ 40 → blocked until `(the 40th most recent attempt).occurred_at + 60 min`.
  Example for the tests: 40 calls from 10:00 to 10:39 → blocked until 11:00 (about 20 min cooldown); at 11:00 one call is
  allowed again, and so on as older calls leave the hour.
- Message: "Hourly limit reached (40 calls in the last hour). You can call again at HH:MM (in N min)."
- UI: small counter in the dialer / lead page for agents: "Calls this hour: 23/40"; when blocked, the Call button is
  disabled with the countdown.
- Admins: no limit, no counter.

## 5. Broker cooldown: 2 unanswered tries → 1 hour pause (agents only)

### 5.1 Rule (pure function, `lib/call-cooldown.ts`, tests in `scripts/_call-cooldown-tests.ts`)

Input: all call attempts for the **broker** (every lead with the same `broker_id`, every agent and the admin, channels
`call` and `ai_call`, `direction = 'outbound'`), newest first, each `{ at, unanswered }`.

- `unanswered` = `status` in (`no_answer`, `pending`, `failed`). (*No answer*, *Voicemail left*, *Wrong number* already set
  `status = no_answer`.) `answered` = a real conversation.
- Walk newest → oldest. Stop at the first answered attempt. Count unanswered attempts while the gap between consecutive
  attempts is **< 60 min** (a gap ≥ 60 min starts a fresh streak).
- If streak ≥ 2 and `now < latestAttempt.at + 60 min` → blocked until `latestAttempt.at + 60 min`. Otherwise allowed.

Tests:
- 10:00 NA, 10:05 NA → blocked until 11:05. At 11:05 → allowed.
- 10:05 NA, 11:06 NA → streak 1 → allowed. 11:06 NA, 11:10 NA → blocked until 12:10.
- 10:00 NA, 10:10 answered, 10:20 NA → allowed.

Constants: `MAX_UNANSWERED_TRIES = 2`, `COOLDOWN_MINUTES = 60`.

### 5.2 Enforcement

`lib/call-cooldown-guard.ts` → `checkCallCooldown(leadId)`: read attempts **with the admin client** (other agents' attempts
must count), last 24 h only. Called from `logCallStarted()` for agents only (see §3.5).
Message: "Cooldown: this broker was tried twice without an answer. Try again at HH:MM (in N min)."
**Do not add this check to AI calls or to admin calls.**

UI (agents only): amber banner on the lead page "Cooldown — call again after HH:MM" and the Call button disabled with a
countdown. Optional: "⏳ cooldown" badge in the leads list if it is one cheap query.

## 6. Knowledge tab → admin only

- `components/layout/app-sidebar.tsx`: keep the Knowledge link exactly where it is for admins; do not render it for agents.
- `app/(dashboard)/settings/knowledge/page.tsx`: if not admin → `redirect("/company")`. Knowledge server actions reject non-admins.
- The live call copilot must keep using the knowledge base during agents' calls — check `lib/copilot/kb.ts`; if it reads
  with the agent's client and RLS would hide rows, read with the admin client on the server.

## 7. "Company" page (read-only for agents, editable by admin)

- New page `app/(dashboard)/company/page.tsx`, sidebar item **Company** (icon `Building2`).
- Content stored in the DB so the admin edits it without code: `app_settings` key `company_info` (markdown), or a table
  `company_info (id int primary key default 1, body text, updated_at timestamptz)`; RLS select for authenticated, write admin only.
- Render markdown read-only (existing renderer, or `react-markdown`). Admin sees **Edit** (textarea + Save; server action
  guarded with `isAdminInDb`).
- Seed with **Appendix A** in the migration.

## 8. Test checklist

Build & unit tests
- [ ] `npm run build` + all `scripts/_*-tests.ts` pass (new: mask, cooldown, hourly limit).

Admin (wetrips.co) — must be unchanged
- [ ] Everything looks and works as before: full phone/email, AI call controls and queue, Knowledge, Settings, calls at
      any hour with the old confirmation, no hourly counter, no cooldown banner. New: Requests and Company pages.

Agent
- [ ] No AI call controls anywhere; calling `/api/ai-calls/start` directly returns 403.
- [ ] No full phone number or email anywhere (lead page, list, dialer, SMS, emails, messages, timeline); page source shows
      masked values only, except the dialer's internal dial number. Calls and emails still work.
- [ ] Inside 8–6 Mon–Fri (broker time): can call. Outside: Call button replaced by the request flow.
- [ ] Request → admin sees it with a badge → Grant → agent can make exactly **one** call within 30 min; a second call needs a
      new request. Deny shows the reason. An unused grant expires after 30 min.
- [ ] After 40 calls within an hour the next call is blocked with the time it reopens.
- [ ] Two no-answer calls on one broker → third blocked for 60 min, also for a second agent with a lead for the same broker.
- [ ] No Knowledge link; `/settings/knowledge` redirects to `/company`; copilot still suggests answers.
- [ ] Company page readable; admin can edit and save it.

---

## Appendix A — Company page seed text

> Admin: review this before agents read it. Product name: the call script says **"Loadlinkers TMS"**; the product manual
> calls it **"FreightLink"**. Features in "Full feature list" come from the manual — remove any that are not live yet.

```markdown
# About Loadlinkers

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
```
