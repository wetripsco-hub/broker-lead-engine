-- Allow admins to delete ingestion log entries (e.g. clean up stale
-- error rows from earlier debugging runs).
create policy "ingestion_log_delete" on public.daily_ingestion_log
  for delete using (public.is_admin());
