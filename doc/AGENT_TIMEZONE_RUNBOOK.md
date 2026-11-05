# Runbook — Agent's own time zone from their IP (instead of fixed PKT)

Project: `broker-lead-engine` (Next.js on Vercel + Supabase `yqalyrelltibsjmrkatb`)

> Read `AGENTS.md` first — this repo uses a newer Next.js; check `node_modules/next/dist/docs/` (especially `headers()`)
> before writing code.

## Goal

Today every "your time" shown to an agent is hard-coded to Pakistan (`AGENT_TZ = "Asia/Karachi"`, label `PKT`).
An agent working from Nigeria, for example, sees "Call at 5:00 PM PKT". Instead, detect each agent's time zone from the
IP they connect from, save it, and show every agent-facing time in **their** zone with its real abbreviation
(e.g. `WAT`, `PKT`).

## Owner's decisions (do not go beyond them)

- **Calling rules do not change.** The 8 AM–6 PM window keeps using the **broker's** time zone and the server clock.
  Cooldown, hourly limit and after-hours grants stay exactly as they are. Only how times are **displayed** changes.
- **Admin (wetrips.co) portal unchanged**: admin pages and admin-facing times stay in PKT (`/calls`, Requests,
  Support requests, Agents page, etc.).
- Source of truth = IP location from Vercel's request headers. Fallback order:
  1. Vercel header `x-vercel-ip-timezone` (IANA name, e.g. `Africa/Lagos`)
  2. the browser's `Intl.DateTimeFormat().resolvedOptions().timeZone`
  3. `Asia/Karachi`
- Validate any zone before saving or using it (`new Intl.DateTimeFormat("en-US", { timeZone })` must not throw).

## 1. Store it

Migration: on `public.agents` add
`ip_timezone text, ip_country text, ip_city text, ip_location_at timestamptz`.
Agents must not be able to edit these through the API (extend the existing guard trigger or write them only with the
service role).

## 2. Detect it (heartbeat + sign-in)

`app/(dashboard)/presence-actions.ts` already runs about once a minute from every open tab
(`components/layout/presence-heartbeat.tsx`). In the same server action:

- Read `x-vercel-ip-timezone`, `x-vercel-ip-country` and `x-vercel-ip-city` (URL-decode the city) via `headers()`.
- Let the heartbeat also send the browser zone (`Intl…timeZone`) as a fallback argument.
- Pick the zone using the fallback order above; save `ip_timezone`, `ip_country`, `ip_city`, `ip_location_at` with the
  service-role client, **only when something changed** (avoid a write every minute).
- Do the same right after a successful sign-in, so the first page already has the right zone.
- On localhost (no Vercel headers) the browser zone is used — that's expected.

## 3. Use it for agent-facing times

- `lib/timezone/broker-time.ts`: change `formatAgentClock(now)` and `formatAgentTimeAt(target, now)` to take the agent's
  zone: `formatAgentClock(now, tz)` / `formatAgentTimeAt(target, now, tz)`. Default `tz = AGENT_TZ` so admin/other callers
  keep PKT. Abbreviation: use `Intl` `timeZoneName: "short"`; keep the override `Asia/Karachi → "PKT"` (Intl prints
  `GMT+5`); for other zones that come out as `GMT±N`, show that as-is.
- Add a small server helper `getViewerTimezone()` → for an agent returns their saved `ip_timezone` (validated), for the
  admin returns `AGENT_TZ`.
- Pass the zone to every agent-facing place (found by grep; search again for `formatAgentClock`, `formatAgentTimeAt`,
  `PKT`, `AGENT_TZ`):

| File | What changes |
|---|---|
| `components/leads/local-time-card.tsx` | "Pakistan: 9:42 PM" → "Your time: 5:42 PM WAT" (label "Your time" for agents; admin keeps "Pakistan") |
| `components/leads/call-status.tsx` | "Call at …" in the agent's zone |
| `components/leads/agent-call-banner.tsx` | cooldown "until …" in the agent's zone |
| `lib/call-cooldown-guard.ts` | server message "Try again at HH:MM" in the agent's zone |
| `lib/agent-call-rules.ts` | hourly-limit message in the agent's zone |
| `app/onboarding/tour/tour-client.tsx` | example "You 9:42 PM PKT" and the text "broker time next to PKT" → "next to your local time" |

Client components get the zone as a prop from the server page; don't read the header on the client.

## 4. Admin can see it

On the admin **Agents** page, next to online / last seen / last login, show:
"📍 Lagos, Nigeria · WAT (UTC+1) · updated 3 min ago" from `ip_city`, `ip_country`, `ip_timezone`, `ip_location_at`.
Use full country names (`Intl.DisplayNames` with type `region`). Admin's own times on that page stay PKT.

## 5. Test checklist

- [ ] `npm run build` + all `scripts/_*-tests.ts` pass. Add tests for zone validation, fallback order and the
      abbreviation helper (`Asia/Karachi → PKT`, `Africa/Lagos → WAT` or `GMT+1`, invalid → fallback).
- [ ] Deployed: agent logs in → Agents page shows their city/country/zone within a minute.
- [ ] Agent from Pakistan still sees PKT everywhere. With a VPN set to another country (e.g. Nigeria/UK) the agent's
      times switch to that zone after the next heartbeat.
- [ ] Calling window unchanged: a broker at 7 PM local time is still blocked for an agent in any country; a broker at
      10 AM is open.
- [ ] Admin pages unchanged (still PKT).

Known limit (explain to the owner, no code needed): with a VPN the IP shows the VPN's country, so the agent's displayed
time follows the VPN. The calling rules are not affected, because they use the broker's time.
