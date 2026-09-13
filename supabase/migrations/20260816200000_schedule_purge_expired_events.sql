-- Schedule automatic purge of expired events, tickets, and resale listings.
-- Runs every 5 minutes via pg_cron so items disappear from the app shortly after end_datetime.
SELECT cron.schedule(
  'purge-expired-events',
  '*/5 * * * *',
  $$SELECT public.purge_expired_tickets_and_resales();$$
);
