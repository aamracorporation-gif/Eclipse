-- FIX: fulfill_payment_for_user to restore VIP ticket creation and use safe RETURNING
CREATE OR REPLACE FUNCTION public.fulfill_payment_for_user(
  p_payment_intent_id text,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tx public.payment_transactions%ROWTYPE;
  v_kind text;
  v_event_id uuid;
  v_ticket_type_id uuid;
  v_quantity integer;
  v_price_cents integer;
  v_event_available integer;
  v_ticket_type_available integer;
  v_single_price numeric;
  v_listing public.resale_listings%ROWTYPE;
  v_ticket public.tickets%ROWTYPE;
  v_commission numeric;
  v_seller_amount numeric;
  v_seller_wallet public.wallets%ROWTYPE;
  v_buyer_wallet public.wallets%ROWTYPE;
  v_ticket_ids uuid[];
  v_original_total_cents integer;
  v_wallet_debit_cents integer;
  v_vip_id uuid;
  v_vip public.reservados_vip%ROWTYPE;
BEGIN
  -- 1. Get and lock transaction
  SELECT * INTO v_tx
  FROM public.payment_transactions
  WHERE stripe_payment_intent_id = p_payment_intent_id
  FOR UPDATE;

  IF v_tx IS NULL THEN
    RAISE EXCEPTION 'Payment transaction not found';
  END IF;

  IF v_tx.user_id IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Payment does not belong to user';
  END IF;

  IF v_tx.status = 'fulfilled' THEN
    RETURN jsonb_build_object('fulfilled', true, 'kind', v_tx.kind);
  END IF;

  v_kind := v_tx.kind;

  -- 2. Handle based on kind
  IF v_kind = 'event_ticket' THEN
    v_event_id := (v_tx.metadata->>'event_id')::uuid;
    v_ticket_type_id := NULLIF(v_tx.metadata->>'ticket_type_id', '')::uuid;
    v_quantity := GREATEST((v_tx.metadata->>'quantity')::int, 1);

    -- Stock check
    SELECT available_tickets INTO v_event_available
    FROM public.events
    WHERE id = v_event_id
    FOR UPDATE;

    IF v_event_available < v_quantity THEN
      RAISE EXCEPTION 'Not enough tickets available in event';
    END IF;

    IF v_ticket_type_id IS NOT NULL THEN
      SELECT quantity - COALESCE(sold, 0) INTO v_ticket_type_available
      FROM public.event_ticket_types
      WHERE id = v_ticket_type_id AND event_id = v_event_id
      FOR UPDATE;
      IF v_ticket_type_available < v_quantity THEN
        RAISE EXCEPTION 'Not enough tickets of this type available';
      END IF;
    END IF;

    -- Pricing check
    IF v_ticket_type_id IS NULL THEN
      SELECT ROUND(e.ticket_price * 100)::int INTO v_price_cents
      FROM public.events e WHERE e.id = v_event_id;
    ELSE
      SELECT ROUND(t.price * 100)::int INTO v_price_cents
      FROM public.event_ticket_types t WHERE t.id = v_ticket_type_id;
    END IF;

    v_original_total_cents := COALESCE(NULLIF(v_tx.metadata->>'original_total_cents', '')::int, (v_price_cents * v_quantity));
    v_wallet_debit_cents := COALESCE(NULLIF(v_tx.metadata->>'wallet_debit_cents', '')::int, 0);

    -- Wallet deduction if applicable
    IF v_wallet_debit_cents > 0 THEN
      UPDATE public.wallets
      SET balance = balance - (v_wallet_debit_cents::numeric / 100), updated_at = now()
      WHERE user_id = p_user_id;
      
      INSERT INTO public.wallet_transactions (wallet_id, amount, type, description, reference_id)
      SELECT id, (v_wallet_debit_cents::numeric / 100), 'debit', 'Compra de entrada (saldo)', v_event_id
      FROM public.wallets WHERE user_id = p_user_id;
    END IF;

    -- Update event stats
    UPDATE public.events
    SET available_tickets = available_tickets - v_quantity,
        sold_tickets = COALESCE(sold_tickets, 0) + v_quantity
    WHERE id = v_event_id;

    -- [CAPACITY MILESTONES ORGANIZER]
    DECLARE
      v_total_capacity integer;
      v_current_sold integer;
      v_organizer_id uuid;
    BEGIN
      SELECT (available_tickets + sold_tickets), sold_tickets, creator_id 
      INTO v_total_capacity, v_current_sold, v_organizer_id 
      FROM public.events WHERE id = v_event_id;

      IF v_current_sold >= v_total_capacity THEN
        PERFORM public.notify(v_organizer_id, 'organizer', 'sold_out', '🔥 ¡EVENTO AGOTADO! Has completado el 100% del aforo.');
      ELSIF v_current_sold >= (v_total_capacity * 0.8) AND (v_current_sold - v_quantity) < (v_total_capacity * 0.8) THEN
        PERFORM public.notify(v_organizer_id, 'organizer', 'capacity_80', '🚀 ¡Impresionante! Has alcanzado el 80% del aforo.');
      ELSIF v_current_sold >= (v_total_capacity * 0.5) AND (v_current_sold - v_quantity) < (v_total_capacity * 0.5) THEN
        PERFORM public.notify(v_organizer_id, 'organizer', 'capacity_50', '🎉 ¡Buen ritmo! Ya has vendido la mitad del aforo (50%).');
      END IF;
    END;

    IF v_ticket_type_id IS NOT NULL THEN
      UPDATE public.event_ticket_types
      SET sold = COALESCE(sold, 0) + v_quantity
      WHERE id = v_ticket_type_id;
    END IF;

    v_single_price := (v_price_cents::numeric / 100);
    v_ticket_ids := ARRAY[]::uuid[];

    -- Create tickets
    FOR i IN 1..v_quantity LOOP
      INSERT INTO public.tickets (
        event_id, user_id, buyer_name, buyer_email, qr_token, qr_code,
        ticket_type_id, total_price, status, ticket_status, payment_transaction_id, stripe_payment_intent_id
      )
      VALUES (
        v_event_id, p_user_id, 
        COALESCE(NULLIF(v_tx.metadata->>'buyer_name', ''), 'Comprador'),
        COALESCE(NULLIF(v_tx.metadata->>'buyer_email', ''), 'sin-email'),
        gen_random_uuid(), gen_random_uuid()::text,
        v_ticket_type_id, v_single_price, 'valid', 'active', v_tx.id, v_tx.stripe_payment_intent_id
      )
      RETURNING * INTO v_ticket;
      v_ticket_ids := array_append(v_ticket_ids, v_ticket.id);
    END LOOP;

    -- [NOTIFICACIÓN CLIENTE] Compra realizada y Ticket generado
    PERFORM public.notify(p_user_id, 'attendee', 'purchase_completed', '🎟️ ¡Entrada asegurada! Prepárate, porque este evento ya es parte de tu historia.');
    PERFORM public.notify(p_user_id, 'attendee', 'ticket_ready', '📲 Tu pase secreto está listo. Este QR es tu llave al evento.');

    -- [NOTIFICACIÓN ORGANIZADOR] Nueva venta
    SELECT creator_id INTO v_event_id FROM public.events WHERE id = v_event_id; -- Reuse variable for organizer id
    PERFORM public.notify(v_event_id, 'organizer', 'new_sale', '💰 ¡Nueva venta! Alguien acaba de asegurar su lugar en tu evento.');

  ELSIF v_kind = 'vip_table' THEN
    v_vip_id := NULLIF(v_tx.metadata->>'vip_reservado_id', '')::uuid;
    IF v_vip_id IS NULL THEN
      v_vip_id := NULLIF(v_tx.metadata->>'reference_id', '')::uuid;
    END IF;

    SELECT * INTO v_vip FROM public.reservados_vip WHERE id = v_vip_id FOR UPDATE;
    IF v_vip IS NULL THEN RAISE EXCEPTION 'VIP not found'; END IF;

    v_wallet_debit_cents := COALESCE(NULLIF(v_tx.metadata->>'wallet_debit_cents', '')::int, 0);
    v_original_total_cents := ROUND(v_vip.base_price * 100)::int;

    -- Wallet deduction
    IF v_wallet_debit_cents > 0 THEN
      UPDATE public.wallets SET balance = balance - (v_wallet_debit_cents::numeric / 100), updated_at = now()
      WHERE user_id = p_user_id;
    END IF;

    -- Update VIP stock
    UPDATE public.reservados_vip SET quantity_available = quantity_available - 1 WHERE id = v_vip.id;

    -- Create VIP ticket
    INSERT INTO public.tickets (
      event_id, user_id, buyer_name, buyer_email, quantity, qr_token, qr_code,
      ticket_type_id, total_price, status, ticket_status, payment_transaction_id, stripe_payment_intent_id
    )
    VALUES (
      v_vip.event_id, p_user_id,
      COALESCE(NULLIF(v_tx.metadata->>'buyer_name', ''), 'Comprador'),
      COALESCE(NULLIF(v_tx.metadata->>'buyer_email', ''), 'sin-email'),
      GREATEST(COALESCE(v_vip.capacity_people, 1), 1),
      gen_random_uuid(), gen_random_uuid()::text,
      NULL, v_vip.base_price, 'valid', 'active', v_tx.id, v_tx.stripe_payment_intent_id
    )
    RETURNING * INTO v_ticket;
    v_ticket_ids := ARRAY[v_ticket.id];

    -- [NOTIFICACIÓN CLIENTE] Compra realizada y Ticket generado (VIP)
    PERFORM public.notify(p_user_id, 'attendee', 'vip_purchase_completed', '💎 ¡VIP confirmado! Vas a vivir una noche exclusiva.');
    PERFORM public.notify(p_user_id, 'attendee', 'ticket_ready', '📲 Tu pase secreto está listo. Este QR es tu llave al evento.');

    -- [NOTIFICACIÓN ORGANIZADOR] Nueva venta VIP
    SELECT creator_id INTO v_vip_id FROM public.events WHERE id = v_vip.event_id;
    PERFORM public.notify(v_vip_id, 'organizer', 'new_sale', '💰 ¡Venta VIP! Alguien ha reservado una mesa en tu evento.');

  ELSIF v_kind = 'resale_ticket' THEN
    -- Resale logic (keeping it as is, it was already working)
    SELECT * INTO v_listing FROM public.resale_listings WHERE id = (v_tx.metadata->>'listing_id')::uuid AND status = 'active' FOR UPDATE;
    IF v_listing IS NULL THEN RAISE EXCEPTION 'Listing not found'; END IF;

    v_commission := v_listing.price * 0.10;
    v_seller_amount := v_listing.price - v_commission;

    UPDATE public.wallets SET balance = balance + v_seller_amount WHERE user_id = v_listing.seller_id;
    
    -- [NOTIFICACIÓN VENDEDOR REVENTA] Ticket vendido
    PERFORM public.notify(v_listing.seller_id, 'attendee', 'resale_sold', '🤝 Has pasado tu entrada. Ahora otra persona vivirá esta experiencia.');

    UPDATE public.resale_listings SET status = 'sold', updated_at = now() WHERE id = v_listing.id;

    INSERT INTO public.resale_transactions (listing_id, ticket_id, seller_id, buyer_id, price, commission, seller_amount, payment_transaction_id, stripe_payment_intent_id)
    VALUES (v_listing.id, v_listing.ticket_id, v_listing.seller_id, p_user_id, v_listing.price, v_commission, v_seller_amount, v_tx.id, v_tx.stripe_payment_intent_id);

    UPDATE public.tickets SET
      user_id = p_user_id, status = 'valid', ticket_status = 'active',
      qr_token = gen_random_uuid(), qr_code = gen_random_uuid()::text,
      transfer_count = COALESCE(transfer_count, 0) + 1,
      last_transferred_at = now(),
      payment_transaction_id = v_tx.id, stripe_payment_intent_id = v_tx.stripe_payment_intent_id
    WHERE id = v_listing.ticket_id;

    -- [NOTIFICACIÓN COMPRADOR REVENTA] Ticket recibido
    PERFORM public.notify(p_user_id, 'attendee', 'resale_bought', '🎁 Te han transferido una entrada. Tienes plan sin haberlo buscado.');
    v_ticket_ids := ARRAY[v_listing.ticket_id];
  END IF;

  -- 3. Mark transaction as fulfilled
  UPDATE public.payment_transactions
  SET status = 'fulfilled', fulfilled_at = now()
  WHERE id = v_tx.id;

  RETURN jsonb_build_object('fulfilled', true, 'kind', v_kind, 'tickets', jsonb_build_object('ids', v_ticket_ids));
END;
$$;
