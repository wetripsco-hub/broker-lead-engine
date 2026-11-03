-- Removing an agent who has call/email/SMS history keeps that history
-- (outreach_events.agent_id is ON DELETE RESTRICT). Such agents are archived
-- instead: login blocked, leads unassigned, row hidden from the Agents page.
alter table public.agents add column if not exists deleted_at timestamptz;
