-- Phase 5: add Telnyx credential ID column to agents
-- This stores the Telnyx telephony_credential resource ID so we can
-- mint fresh WebRTC JWTs without creating a new credential each time.
alter table agents
  add column if not exists telnyx_credential_id text;
