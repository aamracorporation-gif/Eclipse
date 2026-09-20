-- Follow-up to the atomic refund decision: align row locking with resale
-- creation, cancellation and wallet settlement to avoid lock inversion.
CREATE OR REPLACE FUNCTION public.fulfill_payment_for_user(p_payment_intent_id text, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
  v_tx public.payment_transactions%ROWTYPE;
  v_listing public.resale_listings%ROWTYPE;
  v_ticket public.tickets%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_reason text;
  v_result jsonb;
BEGIN
  SELECT * INTO v_tx FROM public.payment_transactions
  WHERE stripe_payment_intent_id = p_payment_intent_id FOR UPDATE;
  IF NOT FOUND OR v_tx.user_id IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Payment transaction unavailable' USING ERRCODE = '42501';
  END IF;
  IF v_tx.status = 'fulfilled' THEN
    RETURN jsonb_build_object('fulfilled', true, 'kind', v_tx.kind);
  END IF;
  IF v_tx.kind <> 'resale_ticket' THEN
    RETURN public.fulfill_payment_for_user_legacy_20260920(p_payment_intent_id, p_user_id);
  END IF;
  IF v_tx.status IN ('refund_pending', 'refunded', 'refund_failed') THEN
    RETURN jsonb_build_object('fulfilled', false, 'kind', v_tx.kind,
      'status', v_tx.status, 'refund_required', v_tx.status = 'refund_pending');
  END IF;

  -- Listing creation, cancellation, wallet purchase and card settlement all
  -- lock the ticket first. An unlocked subquery only finds the ticket ID.
  SELECT t.* INTO v_ticket FROM public.tickets t
  WHERE t.id = (SELECT l.ticket_id FROM public.resale_listings l
    WHERE l.id = NULLIF(v_tx.metadata->>'listing_id', '')::uuid)
  FOR UPDATE;
  SELECT * INTO v_listing FROM public.resale_listings
  WHERE id = NULLIF(v_tx.metadata->>'listing_id', '')::uuid FOR UPDATE;
  IF NOT FOUND OR v_listing.status IS DISTINCT FROM 'active'
    OR v_listing.seller_id IS NULL OR v_listing.seller_id = p_user_id
    OR v_tx.status = 'canceled' THEN
    v_reason := 'listing_unavailable';
  ELSE
    IF v_ticket.id IS NULL OR v_ticket.id IS DISTINCT FROM v_listing.ticket_id
      OR v_ticket.user_id IS DISTINCT FROM v_listing.seller_id
      OR v_ticket.status IS DISTINCT FROM 'resale'
      OR v_ticket.ticket_status IS DISTINCT FROM 'reselling'
      OR v_ticket.scanned_at IS NOT NULL OR v_ticket.validation_status = 'used'
      OR coalesce(v_ticket.wallet_added, false)
      OR v_ticket.payment_status IS DISTINCT FROM 'paid' THEN
      v_reason := 'ticket_unavailable';
    ELSE
      SELECT * INTO v_event FROM public.events WHERE id = v_ticket.event_id FOR SHARE;
      IF NOT FOUND OR NOT coalesce(v_event.allow_resale, true)
        OR coalesce(v_event.is_cancelled, false)
        OR v_event.status IN ('cancelled', 'deleted')
        OR coalesce(v_event.end_datetime, v_event.event_date + interval '5 hours') IS NULL
        OR coalesce(v_event.end_datetime, v_event.event_date + interval '5 hours') <= now() THEN
        v_reason := 'event_unavailable';
      ELSIF v_tx.metadata->>'ticket_id' IS DISTINCT FROM v_ticket.id::text
        OR v_tx.metadata->>'seller_id' IS DISTINCT FROM v_listing.seller_id::text
        OR v_listing.price IS NULL OR v_listing.price <= 0
        OR round(v_listing.price * 100)::int IS DISTINCT FROM
          NULLIF(v_tx.metadata->>'original_total_cents', '')::int THEN
        v_reason := 'listing_changed';
      END IF;
    END IF;
  END IF;

  IF v_reason IS NOT NULL THEN
    UPDATE public.payment_transactions
    SET status = 'refund_pending',
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('refund_reason', v_reason)
    WHERE id = v_tx.id;
    RETURN jsonb_build_object('fulfilled', false, 'kind', v_tx.kind,
      'status', 'refund_pending', 'refund_required', true);
  END IF;

  -- Unexpected database or network failures are retried, never treated as a refund decision.
  v_result := public.fulfill_payment_for_user_legacy_20260920(p_payment_intent_id, p_user_id);
  IF (v_result->>'fulfilled')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Resale fulfillment did not complete';
  END IF;
  UPDATE public.tickets
  SET qr_code = qr_token::text,
      buyer_name = coalesce((SELECT nullif(full_name, '') FROM public.profiles WHERE id = p_user_id), 'Comprador'),
      buyer_email = coalesce((SELECT email FROM public.profiles WHERE id = p_user_id), '')
  WHERE id = v_ticket.id AND user_id = p_user_id;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.fulfill_payment_for_user(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_payment_for_user(text, uuid) TO service_role;
