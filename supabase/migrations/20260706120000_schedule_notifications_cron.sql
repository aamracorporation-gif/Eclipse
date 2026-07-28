-- Enable pg_cron if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule event reminder notifications every 15 minutes
SELECT cron.schedule(
  'schedule-event-notifications',
  '*/15 * * * *',
  $$SELECT public.schedule_event_notifications();$$
);

NOTIFY pgrst, 'reload schema';
