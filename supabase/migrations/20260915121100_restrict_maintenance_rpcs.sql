-- Destructive maintenance is executed by pg_cron or trusted service workers,
-- never by a mobile session.

REVOKE ALL ON FUNCTION public.cleanup_old_events()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_expired_tickets_and_resales()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.cleanup_old_events() TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_expired_tickets_and_resales() TO service_role;
