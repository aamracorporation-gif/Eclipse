-- Restore RPCs referenced by the current client. Both bind ownership to
-- auth.uid(); caller-supplied user identifiers are never trusted.

CREATE OR REPLACE FUNCTION public.cancel_resale_listing_secure(p_ticket_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_listing_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Match the lock order used when creating a listing: ticket, then listing.
  PERFORM 1
  FROM public.tickets
  WHERE id = p_ticket_id
    AND user_id = auth.uid()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found or not owned by caller' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_listing_id
  FROM public.resale_listings
  WHERE ticket_id = p_ticket_id
    AND seller_id = auth.uid()
    AND status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No active listing found';
  END IF;

  DELETE FROM public.resale_listings WHERE id = v_listing_id;
  UPDATE public.tickets
  SET status = 'valid', ticket_status = 'active'
  WHERE id = p_ticket_id AND user_id = auth.uid();

  RETURN jsonb_build_object('success', true, 'ticket_id', p_ticket_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_all_notifications_read(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.notifications
  SET read = true, read_at = now(), status = 'read'
  WHERE user_id = auth.uid()
    AND (read IS DISTINCT FROM true OR read_at IS NULL OR status IS DISTINCT FROM 'read');
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_resale_listing_secure(uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_all_notifications_read(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_resale_listing_secure(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read(uuid)
  TO authenticated, service_role;
