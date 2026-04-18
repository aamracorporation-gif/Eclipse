CREATE OR REPLACE FUNCTION public.create_resale_listing_secure(
  p_ticket_id uuid,
  p_price numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket public.tickets%ROWTYPE;
  v_existing public.resale_listings%ROWTYPE;
  v_listing_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_price IS NULL OR p_price <= 0 THEN
    RAISE EXCEPTION 'Invalid resale price';
  END IF;

  SELECT * INTO v_ticket
  FROM public.tickets
  WHERE id = p_ticket_id
  FOR UPDATE;

  IF v_ticket IS NULL THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;

  IF v_ticket.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not the ticket owner';
  END IF;

  IF v_ticket.scanned_at IS NOT NULL OR v_ticket.status = 'used' OR v_ticket.validation_status = 'used' OR v_ticket.ticket_status = 'used' THEN
    RAISE EXCEPTION 'Ticket already used';
  END IF;

  IF v_ticket.ticket_status = 'reselling' OR v_ticket.status = 'resale' THEN
    RAISE EXCEPTION 'Ticket already in resale';
  END IF;

  IF v_ticket.total_price IS NOT NULL THEN
    IF p_price < v_ticket.total_price THEN
      RAISE EXCEPTION 'Resale price cannot be lower than original price';
    END IF;

    IF p_price > (v_ticket.total_price * 1.2) THEN
      RAISE EXCEPTION 'Resale price cannot exceed 120%% of original price';
    END IF;
  END IF;

  SELECT * INTO v_existing
  FROM public.resale_listings
  WHERE ticket_id = p_ticket_id AND status = 'active'
  FOR UPDATE;

  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'Active resale listing already exists';
  END IF;

  UPDATE public.tickets
  SET status = 'resale',
      ticket_status = 'reselling'
  WHERE id = p_ticket_id;

  INSERT INTO public.resale_listings (ticket_id, seller_id, price, status, created_at, updated_at)
  VALUES (p_ticket_id, auth.uid(), p_price, 'active', now(), now())
  ON CONFLICT (ticket_id) DO UPDATE
  SET
    seller_id = EXCLUDED.seller_id,
    price = EXCLUDED.price,
    status = 'active',
    updated_at = now()
  RETURNING id INTO v_listing_id;

  RETURN jsonb_build_object('listing_id', v_listing_id, 'ticket_id', p_ticket_id);
END;
$$;

REVOKE ALL ON FUNCTION public.create_resale_listing_secure(uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_resale_listing_secure(uuid, numeric) TO authenticated;

NOTIFY pgrst, 'reload schema';

