CREATE OR REPLACE FUNCTION public.handle_payment_fulfilled_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_kind text;
  v_event public.events%ROWTYPE;
  v_qty int;
  v_name text;
  v_data jsonb;

  v_listing public.resale_listings%ROWTYPE;
  v_ticket public.tickets%ROWTYPE;
BEGIN
  BEGIN
    IF TG_OP <> 'UPDATE' THEN
      RETURN NEW;
    END IF;

    IF NEW.status IS DISTINCT FROM 'fulfilled' OR OLD.status = 'fulfilled' THEN
      RETURN NEW;
    END IF;

    v_kind := NEW.kind;

    IF v_kind = 'event_ticket' THEN
      v_qty := GREATEST(COALESCE((NEW.metadata->>'quantity')::int, 1), 1);
      v_name := COALESCE(NULLIF(NEW.metadata->>'buyer_name', ''), '¡Genial!');

      SELECT * INTO v_event
      FROM public.events
      WHERE id = NULLIF(NEW.metadata->>'event_id', '')::uuid;

      IF v_event.id IS NULL THEN
        RETURN NEW;
      END IF;

      v_data := jsonb_build_object(
        'name', v_name,
        'event_id', v_event.id::text,
        'event_title', COALESCE(v_event.title, ''),
        'quantity', v_qty::text,
        'payment_intent_id', COALESCE(NEW.stripe_payment_intent_id, '')
      );

      PERFORM public.enqueue_notification_from_template(
        NEW.user_id,
        'attendee',
        'purchase_completed',
        v_data
      );

      IF v_event.creator_id IS NOT NULL THEN
        PERFORM public.enqueue_notification_from_template(
          v_event.creator_id,
          'organizer',
          'organizer_realtime_sale',
          v_data
        );
      END IF;

      RETURN NEW;
    END IF;

    IF v_kind = 'resale_ticket' THEN
      SELECT * INTO v_listing
      FROM public.resale_listings
      WHERE id = NULLIF(NEW.metadata->>'listing_id', '')::uuid;

      IF v_listing.id IS NULL THEN
        RETURN NEW;
      END IF;

      SELECT * INTO v_ticket
      FROM public.tickets
      WHERE id = v_listing.ticket_id;

      IF v_ticket.id IS NULL THEN
        RETURN NEW;
      END IF;

      SELECT * INTO v_event
      FROM public.events
      WHERE id = v_ticket.event_id;

      IF v_event.id IS NULL THEN
        RETURN NEW;
      END IF;

      v_data := jsonb_build_object(
        'name', COALESCE(NULLIF(NEW.metadata->>'buyer_name', ''), '¡Genial!'),
        'event_id', v_event.id::text,
        'event_title', COALESCE(v_event.title, ''),
        'quantity', '1',
        'ticket_id', v_ticket.id::text,
        'listing_id', v_listing.id::text,
        'buyer_id', COALESCE(NEW.user_id::text, ''),
        'seller_id', COALESCE(v_listing.seller_id::text, ''),
        'payment_intent_id', COALESCE(NEW.stripe_payment_intent_id, '')
      );

      PERFORM public.enqueue_notification_from_template(
        NEW.user_id,
        'attendee',
        'purchase_completed',
        v_data
      );

      IF v_listing.seller_id IS NOT NULL AND v_listing.seller_id IS DISTINCT FROM NEW.user_id THEN
        PERFORM public.enqueue_notification_from_template(
          v_listing.seller_id,
          'attendee',
          'resale_sold',
          v_data
        );
      END IF;

      IF v_event.creator_id IS NOT NULL THEN
        PERFORM public.enqueue_notification_from_template(
          v_event.creator_id,
          'organizer',
          'organizer_realtime_sale',
          v_data
        );
      END IF;

      RETURN NEW;
    END IF;
  EXCEPTION WHEN others THEN
    RETURN NEW;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_fulfilled_notifications ON public.payment_transactions;
CREATE TRIGGER trg_payment_fulfilled_notifications
AFTER UPDATE ON public.payment_transactions
FOR EACH ROW
EXECUTE FUNCTION public.handle_payment_fulfilled_notifications();

DROP FUNCTION IF EXISTS public.trigger_notifications_on_transaction_complete();

CREATE OR REPLACE FUNCTION public.buy_resale_ticket(
  p_buyer_id uuid,
  p_listing_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_listing public.resale_listings%ROWTYPE;
  v_buyer_wallet public.wallets%ROWTYPE;
  v_seller_wallet public.wallets%ROWTYPE;
  v_ticket public.tickets%ROWTYPE;
  v_ticket_id uuid;
  v_commission numeric;
  v_seller_amount numeric;
  v_pi text;
  v_tx_id uuid;
BEGIN
  SELECT * INTO v_listing
  FROM public.resale_listings
  WHERE id = p_listing_id AND status = 'active'
  FOR UPDATE;

  IF v_listing IS NULL THEN
    RAISE EXCEPTION 'Listing not found or not active';
  END IF;

  v_ticket_id := v_listing.ticket_id;

  IF v_listing.seller_id = p_buyer_id THEN
    RAISE EXCEPTION 'Cannot buy your own ticket';
  END IF;

  SELECT * INTO v_ticket
  FROM public.tickets
  WHERE id = v_ticket_id
  FOR UPDATE;

  IF v_ticket IS NULL THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;

  IF v_ticket.ticket_status IS DISTINCT FROM 'reselling' AND v_ticket.status IS DISTINCT FROM 'resale' THEN
    RAISE EXCEPTION 'Ticket is not in resale state';
  END IF;

  IF v_ticket.total_price IS NOT NULL AND v_listing.price > (v_ticket.total_price * 1.2) THEN
    RAISE EXCEPTION 'Resale price cannot exceed 120%% of original price';
  END IF;

  SELECT * INTO v_buyer_wallet
  FROM public.wallets
  WHERE user_id = p_buyer_id
  FOR UPDATE;

  IF v_buyer_wallet IS NULL THEN
    INSERT INTO public.wallets (user_id, balance) VALUES (p_buyer_id, 0) RETURNING * INTO v_buyer_wallet;
  END IF;

  IF v_buyer_wallet.balance < v_listing.price THEN
    RAISE EXCEPTION 'Insufficient funds in wallet';
  END IF;

  SELECT * INTO v_seller_wallet
  FROM public.wallets
  WHERE user_id = v_listing.seller_id
  FOR UPDATE;

  IF v_seller_wallet IS NULL THEN
    INSERT INTO public.wallets (user_id, balance) VALUES (v_listing.seller_id, 0) RETURNING * INTO v_seller_wallet;
  END IF;

  v_commission := v_listing.price * 0.10;
  v_seller_amount := v_listing.price - v_commission;

  v_pi := 'wallet_resale:' || p_listing_id::text;

  INSERT INTO public.payment_transactions (
    user_id,
    kind,
    amount_cents,
    currency,
    stripe_payment_intent_id,
    status,
    metadata
  )
  VALUES (
    p_buyer_id,
    'resale_ticket',
    ROUND(v_listing.price * 100)::int,
    'eur',
    v_pi,
    'created',
    jsonb_build_object(
      'listing_id', p_listing_id::text
    )
  )
  RETURNING id INTO v_tx_id;

  UPDATE public.wallets SET balance = balance - v_listing.price WHERE id = v_buyer_wallet.id;
  INSERT INTO public.wallet_transactions (wallet_id, amount, type, description, reference_id)
  VALUES (v_buyer_wallet.id, v_listing.price, 'debit', 'Purchase resale ticket', v_ticket_id);

  UPDATE public.wallets SET balance = balance + v_seller_amount WHERE id = v_seller_wallet.id;
  INSERT INTO public.wallet_transactions (wallet_id, amount, type, description, reference_id)
  VALUES (v_seller_wallet.id, v_seller_amount, 'credit', 'Sold ticket (less 10% commission)', v_ticket_id);

  UPDATE public.resale_listings
  SET status = 'sold', updated_at = now()
  WHERE id = p_listing_id;

  INSERT INTO public.resale_transactions (listing_id, ticket_id, seller_id, buyer_id, price, commission, seller_amount, payment_transaction_id, stripe_payment_intent_id)
  VALUES (p_listing_id, v_ticket_id, v_listing.seller_id, p_buyer_id, v_listing.price, v_commission, v_seller_amount, v_tx_id, v_pi);

  UPDATE public.tickets
  SET
    user_id = p_buyer_id,
    status = 'valid',
    ticket_status = 'active',
    qr_token = gen_random_uuid(),
    qr_code = gen_random_uuid()::text,
    transfer_count = COALESCE(transfer_count, 0) + 1,
    last_transferred_at = now(),
    payment_transaction_id = v_tx_id,
    stripe_payment_intent_id = v_pi
  WHERE id = v_ticket_id;

  UPDATE public.payment_transactions
  SET status = 'fulfilled', fulfilled_at = now()
  WHERE id = v_tx_id;

  RETURN json_build_object(
    'success', true,
    'ticket_id', v_ticket_id,
    'commission', v_commission,
    'seller_amount', v_seller_amount
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.buy_resale_ticket(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
