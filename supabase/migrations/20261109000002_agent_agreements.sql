-- Signed agent agreements. Written only by the server (service role) from the
-- public /agreement page; read only through admin routes. RLS is on with NO
-- policies, and all grants are revoked, so the browser can never touch it.
create table if not exists public.agent_agreements (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  full_name text not null,
  email text not null,
  country text not null,
  agreement_version text not null,
  agreement_sha256 text not null,
  signed_at timestamptz not null default now(),
  ip text,
  user_agent text,
  status text not null default 'signed' check (status in ('signed', 'account_created', 'rejected')),
  agent_user_id uuid,
  admin_note text
);

create index if not exists agent_agreements_signed_at_idx on public.agent_agreements (signed_at desc);

alter table public.agent_agreements enable row level security;
revoke all on public.agent_agreements from anon, authenticated;

-- When each admin last opened the Agreements tab (for the "new" badge).
create table if not exists public.agreement_admin_seen (
  admin_user_id uuid primary key,
  last_seen_at timestamptz not null default now()
);

alter table public.agreement_admin_seen enable row level security;
revoke all on public.agreement_admin_seen from anon, authenticated;
