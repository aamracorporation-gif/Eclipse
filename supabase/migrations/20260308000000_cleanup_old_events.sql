-- Function to clean up old events and their associated tickets
CREATE OR REPLACE FUNCTION public.cleanup_old_events()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM public.resale_listings rl
  USING public.tickets t, public.events e
  WHERE rl.ticket_id = t.id
    AND t.event_id = e.id
    AND e.event_date < NOW() - INTERVAL '72 hours';
END;
$$;

-- Grant execution permission to authenticated users (or restrict as needed)
GRANT EXECUTE ON FUNCTION public.cleanup_old_events() TO authenticated;

-- Reload schema cache (safe even if no changes)
NOTIFY pgrst, 'reload schema';
