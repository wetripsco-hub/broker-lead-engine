# Runbook — Agent Call Recording & Admin Call Review

Project: `broker-lead-engine` (Next.js + Supabase `yqalyrelltibsjmrkatb` + Telnyx WebRTC)
Goal: every call an agent places from the app is recorded (both sides), stored permanently, linked to the
right call row, and the admin can listen to it, read the transcript and see the outcome on one page.

> Before writing code, read `AGENTS.md` — this repo uses a newer Next.js; check `node_modules/next/dist/docs/`
> for route handler / server action conventions.

---

## 0. What is broken today (checked on 2026-11-01)

| # | Finding | Evidence |
|---|---------|----------|
| 1 | **Recording is never started.** `startCallRecording()` exists in `lib/telnyx/client.ts` but nothing calls it. | 0 of 85 call rows in `outreach_events` have `recording_url`. |
| 2 | **Every agent call creates two rows.** The dialer calls `logCallStarted()` (row A, `external_id = null`, gets transcript + disposition). The webhook's `call.initiated` handler inserts a second row (row B, `external_id = call_control_id`, gets status). A recording would attach to row B, while the transcript sits on row A. | 34 rows with `external_id`, 51 without; transcripts only on rows without `external_id`. |
| 3 | **Recording URL is read from the wrong field and would expire.** The webhook reads `payload.public_recording_urls.mp3`, which is often empty. `payload.recording_urls.mp3` is the real link, and Telnyx says it is valid for only **10 minutes**. Saving the link is useless — the file must be downloaded and stored. | Telnyx docs: "Storing call recordings". |

Do **not** change AI calls (Retell, `lib/voice-agents/*`) — they already get their own recording URL.

---

## 1. Link the Telnyx call to the dialer's row (fixes #2)

**`components/leads/dialer-modal.tsx`** — the event row is already created before `newCall()`. Put its id in `clientState`:

```ts
const clientState = btoa(JSON.stringify({ leadId, agentId, eventId: eventIdRef.current }))
```

Do the same in the direct-number dialer (the component that calls `logDirectCallStarted` — `DialerWidget`).

**`app/api/telnyx/webhook/route.ts`** — decode `eventId` from `client_state` alongside `leadId`/`agentId`, then:

- `call.initiated`: if `eventId` is present → `update outreach_events set external_id = call_control_id where id = eventId` (no insert).
  Only if there is no `eventId` (old clients) keep the current insert as a fallback.
- `call.answered` / `call.hangup` / `call.recording.saved`: match on `external_id = call_control_id` as today
  (now it hits the dialer's row). Do not let the webhook's hangup status overwrite a disposition the agent already saved —
  only update `status` when the row's `disposition` is null.

## 2. Start recording when the broker answers (fixes #1)

In the webhook, on `call.answered` for an outbound agent call (row found by `external_id`, `channel = 'call'`):

```ts
try { await startCallRecording(callControlId) } catch (e) { console.error("record_start failed", e) }
```

`startCallRecording` already uses `format: "mp3", channels: "dual", play_beep: false` — keep dual channel
(agent and broker on separate channels, best for review). Never let a recording error break the webhook response.

The recording disclosure is spoken by the agent (see §6), so no Telnyx announcement is played.

## 3. Store the recording permanently (fixes #3)

**Migration** (`supabase/migrations/2026110100000X_call_recordings.sql`):

```sql
insert into storage.buckets (id, name, public) values ('call-recordings', 'call-recordings', false)
on conflict (id) do nothing;

alter table public.outreach_events
  add column if not exists recording_path text,
  add column if not exists recording_seconds integer;
```

No storage policies for signed-in users — only the service role reads/writes this bucket.

**Webhook, `call.recording.saved`:**

1. Find the row by `external_id`. If `recording_path` is already set, return 200 (Telnyx retries — must be idempotent).
2. `const url = payload.recording_urls?.mp3 ?? payload.public_recording_urls?.mp3`
3. Download it immediately (`fetch(url)` → `arrayBuffer`), upload with the admin client to
   `call-recordings/{yyyy}/{mm}/{eventId}.mp3` (`contentType: "audio/mpeg"`, `upsert: true`).
4. Update the row: `recording_path`, `recording_seconds` (from `payload.recording_ended_at - recording_started_at`
   if present). Leave `recording_url` empty for these calls.
5. Set `export const maxDuration = 60` on the route so a large file does not time out on Vercel.
6. If download/upload fails, log it and return a non-2xx so Telnyx retries within the 10-minute window.

**Playback:** add a server action `getCallRecordingUrl(eventId)`:
- read the row through the **signed-in user's** client (RLS decides if they may see it: admin = all, agent = own leads);
- if visible and `recording_path` is set → admin client `storage.from("call-recordings").createSignedUrl(path, 3600)`.
- Update `components/leads/outreach-timeline.tsx` to use this (load the URL when the user presses play),
  falling back to `recording_url` for AI calls.

## 4. Admin page: "Call Reviews" (`/calls`, admin only)

New page `app/(dashboard)/calls/page.tsx`, guarded with `isAdminInDb`; add a sidebar link next to "Agents"
(same admin-only block in `components/layout/app-sidebar.tsx`).

Table of all agent calls (`channel = 'call'`, newest first, 50 per page) with:

- date/time in **PKT** and in the broker's local time
- agent name, company name + MC number (link to the lead), or the direct number
- duration, outcome (disposition label), status
- ▶ play button (signed URL from §3), download link
- expandable transcript (`transcript`) and AI summary (`ai_summary`)

Filters: agent, date range (today / this week / all), outcome, "has recording".

## 5. Make sure every call gets a transcript and an outcome

Currently 0 call rows have a `disposition` and 0 have `ai_summary`, so agents are closing the dialog without saving.
In `dialer-modal.tsx`, after a call that was answered (`seconds > 0`), do not allow closing the wrap-up screen without
saving an outcome (keep a "Skip" only for unanswered calls). `saveCallTranscript` already runs at hang-up — keep it.

## 6. Small script change

In `lib/call-script/script.ts`, make the opening line include the disclosure, e.g.
"Hi, this is {agent} with Loadlinkers — just so you know, this call may be recorded for quality."

## 7. Optional hardening

Verify the Telnyx webhook signature (`telnyx-signature-ed25519` + `telnyx-timestamp` headers, public key from the
Telnyx portal in an env var) so nobody can post fake events to `/api/telnyx/webhook`.

---

## 8. Test checklist (must all pass before handing to agents)

- [ ] `npm run build` and existing `scripts/_*-tests.ts` pass.
- [ ] As the agent account, call your own mobile from a lead, talk 30s, save an outcome.
- [ ] Exactly **one** new `outreach_events` row for that call, with `external_id`, transcript, disposition, `recording_path`.
- [ ] File exists in the `call-recordings` bucket; it plays on the lead page and on `/calls`.
- [ ] Both voices are audible (dual channel).
- [ ] Play it again **after 1 hour** — still works (proves it is stored, not a Telnyx link).
- [ ] Agent account cannot open `/calls` and cannot get a signed URL for another agent's call.
- [ ] Unanswered call: no recording, no error, status `no_answer`.
- [ ] AI (Retell) calls still show their recordings.
