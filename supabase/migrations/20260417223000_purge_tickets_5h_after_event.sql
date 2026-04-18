CREATE OR REPLACE FUNCTION public.purge_expired_tickets_and_resales()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_now timestamptz := now();
  v_resale_tx_deleted int := 0;
  v_resale_listings_deleted int := 0;
  v_tickets_deleted int := 0;
BEGIN
  -- 1) Remove resale transactions linked to tickets whose event finished 5h ago.
  DELETE FROM public.resale_transactions rt
  USING public.tickets t
  JOIN public.events e ON e.id = t.event_id
  WHERE rt.ticket_id = t.id
    AND e.event_date <= (v_now - interval '5 hours');
  GET DIAGNOSTICS v_resale_tx_deleted = ROW_COUNT;

  -- 2) Remove resale listings linked to those tickets.
  DELETE FROM public.resale_listings rl
  USING public.tickets t
  JOIN public.events e ON e.id = t.event_id
  WHERE rl.ticket_id = t.id
    AND e.event_date <= (v_now - interval '5 hours');
  GET DIAGNOSTICS v_resale_listings_deleted = ROW_COUNT;

  -- 3) Finally remove tickets from events ended >= 5h ago.
  DELETE FROM public.tickets t
  USING public.events e
  WHERE t.event_id = e.id
    AND e.event_date <= (v_now - interval '5 hours');
  GET DIAGNOSTICS v_tickets_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'resale_transactions_deleted', v_resale_tx_deleted,
    'resale_listings_deleted', v_resale_listings_deleted,
    'tickets_deleted', v_tickets_deleted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_tickets_and_resales() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_expired_tickets_and_resales() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
