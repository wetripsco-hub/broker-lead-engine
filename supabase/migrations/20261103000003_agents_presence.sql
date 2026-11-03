-- Online / last seen on the admin Agents page. last_seen_at is stamped by a
-- heartbeat from every open dashboard tab (about once a minute);
-- last_signed_out_at by Sign out, so the agent shows offline right away.
alter table public.agents add column if not exists last_seen_at timestamptz;
alter table public.agents add column if not exists last_signed_out_at timestamptz;
