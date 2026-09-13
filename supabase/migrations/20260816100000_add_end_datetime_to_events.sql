-- Add end_datetime to events: required going forward, nullable for existing events
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS end_datetime timestamptz;

-- Update purge function to use end_datetime when available, else event_date + 5h
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
  v_events_deleted int := 0;
BEGIN
  -- 1) Remove resale transactions for expired events
  DELETE FROM public.resale_transactions rt
  USING public.tickets t
  JOIN public.events e ON e.id = t.event_id
  WHERE rt.ticket_id = t.id
    AND COALESCE(e.end_datetime, e.event_date + interval '5 hours') <= v_now;
  GET DIAGNOSTICS v_resale_tx_deleted = ROW_COUNT;

  -- 2) Remove resale listings for expired events
  DELETE FROM public.resale_listings rl
  USING public.tickets t
  JOIN public.events e ON e.id = t.event_id
  WHERE rl.ticket_id = t.id
    AND COALESCE(e.end_datetime, e.event_date + interval '5 hours') <= v_now;
  GET DIAGNOSTICS v_resale_listings_deleted = ROW_COUNT;

  -- 3) Remove tickets for expired events
  DELETE FROM public.tickets t
  USING public.events e
  WHERE t.event_id = e.id
    AND COALESCE(e.end_datetime, e.event_date + interval '5 hours') <= v_now;
  GET DIAGNOSTICS v_tickets_deleted = ROW_COUNT;

  -- 4) Delete the expired events themselves
  DELETE FROM public.events e
  WHERE COALESCE(e.end_datetime, e.event_date + interval '5 hours') <= v_now;
  GET DIAGNOSTICS v_events_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'resale_transactions_deleted', v_resale_tx_deleted,
    'resale_listings_deleted', v_resale_listings_deleted,
    'tickets_deleted', v_tickets_deleted,
    'events_deleted', v_events_deleted
  );
END;
$$;

-- Block buying resale tickets for events that have already ended
CREATE OR REPLACE FUNCTION public.check_event_not_expired(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_end timestamptz;
BEGIN
  SELECT COALESCE(end_datetime, event_date + interval '5 hours')
  INTO v_end
  FROM public.events
  WHERE id = p_event_id;

  IF v_end IS NULL OR v_end <= now() THEN
    RAISE EXCEPTION 'event_expired: Este evento ya ha finalizado.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.check_event_not_expired(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_event_not_expired(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
