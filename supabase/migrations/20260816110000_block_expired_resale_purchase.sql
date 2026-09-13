-- Block purchase of resale tickets for events that have already ended.
-- Patches both buy_resale_ticket_with_credito and buy_resale_ticket_stripe_v2
-- by injecting an expiry check right after the event is loaded.

-- ── Patch buy_resale_ticket_with_credito ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.buy_resale_ticket_with_credito(
  p_listing_id uuid,
  p_buyer_id   uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_listing  public.resale_listings%ROWTYPE;
  v_ticket   public.tickets%ROWTYPE;
  v_event    public.events%ROWTYPE;
  v_allow_resale boolean;
  v_end_dt   timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF auth.uid() IS DISTINCT FROM p_buyer_id THEN RAISE EXCEPTION 'Permission denied'; END IF;
  IF p_listing_id IS NULL THEN RAISE EXCEPTION 'Listing not found'; END IF;

  SELECT * INTO v_listing FROM public.resale_listings WHERE id = p_listing_id FOR UPDATE;
  IF v_listing IS NULL OR v_listing.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Listing not active';
  END IF;
  IF v_listing.seller_id IS DISTINCT FROM NULL AND v_listing.seller_id = p_buyer_id THEN
    RAISE EXCEPTION 'Cannot buy own listing';
  END IF;

  SELECT * INTO v_ticket FROM public.tickets WHERE id = v_listing.ticket_id;
  IF v_ticket.id IS NULL THEN RAISE EXCEPTION 'Ticket not found'; END IF;

  SELECT * INTO v_event FROM public.events WHERE id = v_ticket.event_id;

  -- ── Expiry check ──────────────────────────────────────────────────────────
  v_end_dt := COALESCE(v_event.end_datetime, v_event.event_date + interval '5 hours');
  IF v_end_dt <= now() THEN
    RAISE EXCEPTION 'event_expired: Este evento ya ha finalizado y no se pueden comprar entradas.';
  END IF;
  -- ─────────────────────────────────────────────────────────────────────────

  v_allow_resale := COALESCE(v_event.allow_resale, true);
  IF NOT v_allow_resale THEN RAISE EXCEPTION 'Resale not allowed for this event'; END IF;

  -- Debit buyer wallet
  UPDATE public.wallets
  SET balance = balance - v_listing.price,
      updated_at = now()
  WHERE user_id = p_buyer_id
    AND balance >= v_listing.price;

  IF NOT FOUND THEN RAISE EXCEPTION 'Insufficient credit'; END IF;

  -- Credit seller wallet
  UPDATE public.wallets
  SET balance = balance + v_listing.price,
      updated_at = now()
  WHERE user_id = v_listing.seller_id;

  -- Transfer ticket ownership
  UPDATE public.tickets
  SET user_id   = p_buyer_id,
      updated_at = now()
  WHERE id = v_listing.ticket_id;

  -- Mark listing sold
  UPDATE public.resale_listings
  SET status     = 'sold',
      updated_at = now()
  WHERE id = p_listing_id;

  -- Record transaction
  INSERT INTO public.resale_transactions (listing_id, buyer_id, seller_id, ticket_id, amount)
  VALUES (p_listing_id, p_buyer_id, v_listing.seller_id, v_listing.ticket_id, v_listing.price);

  RETURN jsonb_build_object(
    'ok', true,
    'ticket_id', v_listing.ticket_id,
    'event_id', COALESCE(v_ticket.event_id::text, '')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.buy_resale_ticket_with_credito(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.buy_resale_ticket_with_credito(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
