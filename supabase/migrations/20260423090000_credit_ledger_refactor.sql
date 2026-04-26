DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ledger_movimiento_tipo') THEN
    CREATE TYPE public.ledger_movimiento_tipo AS ENUM (
      'compra_normal',
      'compra_con_credito',
      'generacion_credito_reventa',
      'pago_organizador',
      'comision_plataforma'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.creditos_usuario (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  saldo_credito numeric(10,2) NOT NULL DEFAULT 0.00 CHECK (saldo_credito >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.creditos_usuario ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'creditos_usuario' AND policyname = 'creditos_usuario_select_own'
  ) THEN
    CREATE POLICY creditos_usuario_select_own
    ON public.creditos_usuario
    FOR SELECT
    TO authenticated
    USING (auth.uid() = usuario_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'creditos_usuario' AND policyname = 'creditos_usuario_insert_own_zero'
  ) THEN
    CREATE POLICY creditos_usuario_insert_own_zero
    ON public.creditos_usuario
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = usuario_id AND saldo_credito = 0);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.ledger_movimientos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo public.ledger_movimiento_tipo NOT NULL,
  usuario_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  organizador_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  importe numeric(10,2) NOT NULL,
  referencia_id varchar(255),
  descripcion text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ledger_movimientos_usuario_id ON public.ledger_movimientos(usuario_id);
CREATE INDEX IF NOT EXISTS idx_ledger_movimientos_organizador_id ON public.ledger_movimientos(organizador_id);
CREATE INDEX IF NOT EXISTS idx_ledger_movimientos_tipo_created_at ON public.ledger_movimientos(tipo, created_at DESC);

ALTER TABLE public.ledger_movimientos ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ledger_movimientos' AND policyname = 'ledger_movimientos_select_own_user'
  ) THEN
    CREATE POLICY ledger_movimientos_select_own_user
    ON public.ledger_movimientos
    FOR SELECT
    TO authenticated
    USING (auth.uid() = usuario_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ledger_movimientos' AND policyname = 'ledger_movimientos_select_own_organizer'
  ) THEN
    CREATE POLICY ledger_movimientos_select_own_organizer
    ON public.ledger_movimientos
    FOR SELECT
    TO authenticated
    USING (auth.uid() = organizador_id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'tr_creditos_usuario_set_updated_at'
  ) THEN
    CREATE TRIGGER tr_creditos_usuario_set_updated_at
    BEFORE UPDATE ON public.creditos_usuario
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.ensure_credito_usuario_exists(p_usuario_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row public.creditos_usuario%ROWTYPE;
BEGIN
  SELECT * INTO v_row
  FROM public.creditos_usuario
  WHERE usuario_id = p_usuario_id
  FOR UPDATE;

  IF v_row IS NULL THEN
    INSERT INTO public.creditos_usuario (usuario_id, saldo_credito)
    VALUES (p_usuario_id, 0)
    RETURNING * INTO v_row;
  END IF;

  RETURN v_row.id;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_credito_usuario_exists(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_credito_usuario_exists(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.record_ledger_movimiento(
  p_tipo public.ledger_movimiento_tipo,
  p_usuario_id uuid,
  p_organizador_id uuid,
  p_importe numeric,
  p_referencia_id text,
  p_descripcion text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.ledger_movimientos (tipo, usuario_id, organizador_id, importe, referencia_id, descripcion)
  VALUES (p_tipo, p_usuario_id, p_organizador_id, ROUND(p_importe::numeric, 2), NULLIF(p_referencia_id, ''), NULLIF(p_descripcion, ''))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_ledger_movimiento(public.ledger_movimiento_tipo, uuid, uuid, numeric, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_ledger_movimiento(public.ledger_movimiento_tipo, uuid, uuid, numeric, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_credito_delta(
  p_usuario_id uuid,
  p_delta numeric,
  p_tipo public.ledger_movimiento_tipo,
  p_referencia_id text,
  p_descripcion text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_credit public.creditos_usuario%ROWTYPE;
  v_new_balance numeric;
BEGIN
  PERFORM public.ensure_credito_usuario_exists(p_usuario_id);

  SELECT * INTO v_credit
  FROM public.creditos_usuario
  WHERE usuario_id = p_usuario_id
  FOR UPDATE;

  v_new_balance := ROUND((v_credit.saldo_credito + p_delta)::numeric, 2);
  IF v_new_balance < 0 THEN
    RAISE EXCEPTION 'Insufficient credit';
  END IF;

  UPDATE public.creditos_usuario
  SET saldo_credito = v_new_balance
  WHERE id = v_credit.id;

  PERFORM public.record_ledger_movimiento(p_tipo, p_usuario_id, NULL, p_delta, p_referencia_id, p_descripcion);

  RETURN jsonb_build_object('saldo_credito', v_new_balance);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_credito_delta(uuid, numeric, public.ledger_movimiento_tipo, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_credito_delta(uuid, numeric, public.ledger_movimiento_tipo, text, text) TO service_role;

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
  v_ticket_ids uuid[];
  v_new_ticket_id uuid;
  v_vip_id uuid;
  v_vip public.reservados_vip%ROWTYPE;
  v_credit_debit_cents integer;
  v_original_total_cents integer;
  v_credit_debit numeric;
  i integer;
BEGIN
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
  v_credit_debit_cents := COALESCE(NULLIF(v_tx.metadata->>'credit_debit_cents', '')::int, NULLIF(v_tx.metadata->>'wallet_debit_cents', '')::int, 0);
  IF v_credit_debit_cents < 0 THEN v_credit_debit_cents := 0; END IF;
  v_original_total_cents := COALESCE(NULLIF(v_tx.metadata->>'original_total_cents', '')::int, v_tx.amount_cents + v_credit_debit_cents);

  IF (v_tx.amount_cents + v_credit_debit_cents) <> v_original_total_cents THEN
    RAISE EXCEPTION 'Amount mismatch';
  END IF;

  IF v_kind = 'event_ticket' THEN
    v_event_id := (v_tx.metadata->>'event_id')::uuid;
    v_ticket_type_id := NULLIF(v_tx.metadata->>'ticket_type_id', '')::uuid;
    v_quantity := GREATEST((v_tx.metadata->>'quantity')::int, 1);

    SELECT available_tickets INTO v_event_available
    FROM public.events
    WHERE id = v_event_id
    FOR UPDATE;

    IF v_event_available IS NULL THEN
      RAISE EXCEPTION 'Event not found';
    END IF;

    IF v_event_available < v_quantity THEN
      RAISE EXCEPTION 'Not enough tickets available';
    END IF;

    IF v_ticket_type_id IS NOT NULL THEN
      SELECT (quantity - COALESCE(sold, 0)) INTO v_ticket_type_available
      FROM public.event_ticket_types
      WHERE id = v_ticket_type_id AND event_id = v_event_id
      FOR UPDATE;

      IF v_ticket_type_available IS NULL OR v_ticket_type_available < v_quantity THEN
        RAISE EXCEPTION 'Ticket type sold out';
      END IF;
    END IF;

    IF v_credit_debit_cents > 0 THEN
      v_credit_debit := ROUND((v_credit_debit_cents::numeric / 100)::numeric, 2);
      PERFORM public.apply_credito_delta(p_user_id, -v_credit_debit, 'compra_con_credito', p_payment_intent_id, 'Compra con crédito');
    END IF;

    IF v_tx.amount_cents > 0 THEN
      PERFORM public.record_ledger_movimiento('compra_normal', p_user_id, NULL, ROUND((v_tx.amount_cents::numeric / 100)::numeric, 2), p_payment_intent_id, 'Compra con tarjeta');
    END IF;

    v_single_price := ROUND(((v_original_total_cents::numeric / 100)::numeric / v_quantity)::numeric, 2);

    v_ticket_ids := ARRAY[]::uuid[];
    FOR i IN 1..v_quantity LOOP
      INSERT INTO public.tickets (
        event_id,
        user_id,
        buyer_name,
        buyer_email,
        quantity,
        qr_token,
        qr_code,
        ticket_type_id,
        total_price,
        status,
        ticket_status,
        payment_transaction_id,
        stripe_payment_intent_id
      )
      VALUES (
        v_event_id,
        p_user_id,
        COALESCE(NULLIF(v_tx.metadata->>'buyer_name', ''), 'Comprador'),
        COALESCE(NULLIF(v_tx.metadata->>'buyer_email', ''), 'sin-email'),
        1,
        gen_random_uuid(),
        gen_random_uuid()::text,
        v_ticket_type_id,
        v_single_price,
        'valid',
        'active',
        v_tx.id,
        v_tx.stripe_payment_intent_id
      )
      RETURNING id INTO v_new_ticket_id;

      v_ticket_ids := array_append(v_ticket_ids, v_new_ticket_id);
    END LOOP;

    UPDATE public.events
    SET available_tickets = available_tickets - v_quantity,
        sold_tickets = COALESCE(sold_tickets, 0) + v_quantity
    WHERE id = v_event_id;

    IF v_ticket_type_id IS NOT NULL THEN
      UPDATE public.event_ticket_types
      SET sold = COALESCE(sold, 0) + v_quantity
      WHERE id = v_ticket_type_id;
    END IF;

    UPDATE public.payment_transactions
    SET status = 'fulfilled', fulfilled_at = now()
    WHERE id = v_tx.id;

    RETURN jsonb_build_object('fulfilled', true, 'kind', v_kind, 'tickets', jsonb_build_object('ids', v_ticket_ids));
  ELSIF v_kind = 'resale_ticket' THEN
    SELECT * INTO v_listing
    FROM public.resale_listings
    WHERE id = NULLIF(v_tx.metadata->>'listing_id', '')::uuid
    FOR UPDATE;

    IF v_listing IS NULL OR v_listing.status IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'Listing not active';
    END IF;

    v_commission := ROUND((v_listing.price * 0.12)::numeric, 2);
    v_seller_amount := ROUND((v_listing.price - v_commission)::numeric, 2);

    PERFORM public.apply_credito_delta(v_listing.seller_id, v_seller_amount, 'generacion_credito_reventa', p_payment_intent_id, 'Crédito generado por reventa');
    PERFORM public.record_ledger_movimiento('comision_plataforma', NULL, NULL, v_commission, p_payment_intent_id, 'Comisión plataforma reventa');

    UPDATE public.tickets
    SET
      user_id = p_user_id,
      status = 'valid',
      ticket_status = 'active',
      qr_token = gen_random_uuid(),
      qr_code = gen_random_uuid()::text,
      transfer_count = COALESCE(transfer_count, 0) + 1,
      last_transferred_at = now(),
      payment_transaction_id = v_tx.id,
      stripe_payment_intent_id = v_tx.stripe_payment_intent_id
    WHERE id = v_listing.ticket_id;

    UPDATE public.resale_listings
    SET status = 'sold', updated_at = now()
    WHERE id = v_listing.id;

    INSERT INTO public.resale_transactions (listing_id, ticket_id, seller_id, buyer_id, price, commission, seller_amount, payment_transaction_id, stripe_payment_intent_id)
    VALUES (v_listing.id, v_listing.ticket_id, v_listing.seller_id, p_user_id, v_listing.price, v_commission, v_seller_amount, v_tx.id, v_tx.stripe_payment_intent_id);

    UPDATE public.payment_transactions
    SET status = 'fulfilled', fulfilled_at = now()
    WHERE id = v_tx.id;

    RETURN jsonb_build_object('fulfilled', true, 'kind', v_kind, 'resale', jsonb_build_object('ticket_id', v_listing.ticket_id, 'listing_id', v_listing.id));
  ELSIF v_kind = 'vip_table' THEN
    v_vip_id := NULLIF(v_tx.metadata->>'vip_reservado_id', '')::uuid;
    IF v_vip_id IS NULL THEN
      v_vip_id := NULLIF(v_tx.metadata->>'reference_id', '')::uuid;
    END IF;
    IF v_vip_id IS NULL THEN
      RAISE EXCEPTION 'VIP not found';
    END IF;

    SELECT * INTO v_vip
    FROM public.reservados_vip
    WHERE id = v_vip_id
    FOR UPDATE;

    IF v_vip IS NULL OR COALESCE(v_vip.quantity_available, 0) < 1 THEN
      RAISE EXCEPTION 'VIP sold out';
    END IF;

    v_price_cents := ROUND(v_vip.base_price * 100)::int;

    IF v_original_total_cents <> v_price_cents THEN
      RAISE EXCEPTION 'Amount mismatch';
    END IF;

    IF v_credit_debit_cents > 0 THEN
      v_credit_debit := ROUND((v_credit_debit_cents::numeric / 100)::numeric, 2);
      PERFORM public.apply_credito_delta(p_user_id, -v_credit_debit, 'compra_con_credito', p_payment_intent_id, 'Compra VIP con crédito');
    END IF;

    IF v_tx.amount_cents > 0 THEN
      PERFORM public.record_ledger_movimiento('compra_normal', p_user_id, NULL, ROUND((v_tx.amount_cents::numeric / 100)::numeric, 2), p_payment_intent_id, 'Compra VIP con tarjeta');
    END IF;

    UPDATE public.reservados_vip
    SET quantity_available = quantity_available - 1
    WHERE id = v_vip.id;

    v_single_price := ROUND((v_price_cents::numeric / 100)::numeric, 2);

    INSERT INTO public.tickets (
      event_id,
      user_id,
      buyer_name,
      buyer_email,
      quantity,
      qr_token,
      qr_code,
      ticket_type_id,
      total_price,
      status,
      ticket_status,
      payment_transaction_id,
      stripe_payment_intent_id
    )
    VALUES (
      v_vip.event_id,
      p_user_id,
      COALESCE(NULLIF(v_tx.metadata->>'buyer_name', ''), 'Comprador'),
      COALESCE(NULLIF(v_tx.metadata->>'buyer_email', ''), 'sin-email'),
      GREATEST(COALESCE(v_vip.capacity_people, 1), 1),
      gen_random_uuid(),
      gen_random_uuid()::text,
      NULL,
      v_single_price,
      'valid',
      'active',
      v_tx.id,
      v_tx.stripe_payment_intent_id
    )
    RETURNING id INTO v_new_ticket_id;

    UPDATE public.payment_transactions
    SET status = 'fulfilled', fulfilled_at = now()
    WHERE id = v_tx.id;

    RETURN jsonb_build_object('fulfilled', true, 'kind', v_kind, 'tickets', jsonb_build_object('ids', ARRAY[v_new_ticket_id]));
  END IF;

  RAISE EXCEPTION 'Not implemented';
END;
$$;

REVOKE ALL ON FUNCTION public.fulfill_payment_for_user(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fulfill_payment_for_user(text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.buy_ticket_with_credito(
  p_event_id uuid,
  p_user_id uuid,
  p_buyer_name text,
  p_buyer_email text,
  p_quantity int,
  p_total_price numeric,
  p_qr_code text,
  p_ticket_type_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event_available integer;
  v_ticket_type_available integer;
  v_ticket_id uuid;
  v_ticket_ids uuid[];
  i integer;
  v_single_price numeric;
  v_event public.events%ROWTYPE;
  v_data jsonb;
BEGIN
  IF p_quantity < 1 THEN
    RAISE EXCEPTION 'Invalid quantity';
  END IF;

  PERFORM public.apply_credito_delta(p_user_id, -ROUND(p_total_price::numeric, 2), 'compra_con_credito', NULL, 'Compra con crédito (sin Stripe)');

  SELECT available_tickets INTO v_event_available
  FROM public.events
  WHERE id = p_event_id
  FOR UPDATE;

  IF v_event_available IS NULL THEN
    RAISE EXCEPTION 'Event not found';
  END IF;

  IF v_event_available < p_quantity THEN
    RAISE EXCEPTION 'Not enough tickets available';
  END IF;

  IF p_ticket_type_id IS NOT NULL THEN
    SELECT quantity - COALESCE(sold, 0) INTO v_ticket_type_available
    FROM public.event_ticket_types
    WHERE id = p_ticket_type_id AND event_id = p_event_id
    FOR UPDATE;
    IF v_ticket_type_available IS NULL OR v_ticket_type_available < p_quantity THEN
      RAISE EXCEPTION 'Not enough tickets of this type available';
    END IF;
  END IF;

  v_single_price := ROUND((p_total_price::numeric / p_quantity)::numeric, 2);
  v_ticket_ids := ARRAY[]::uuid[];

  FOR i IN 1..p_quantity LOOP
    INSERT INTO public.tickets (
      event_id,
      user_id,
      buyer_name,
      buyer_email,
      quantity,
      qr_token,
      qr_code,
      ticket_type_id,
      total_price,
      status,
      ticket_status
    )
    VALUES (
      p_event_id,
      p_user_id,
      p_buyer_name,
      p_buyer_email,
      1,
      gen_random_uuid(),
      p_qr_code,
      p_ticket_type_id,
      v_single_price,
      'valid',
      'active'
    )
    RETURNING id INTO v_ticket_id;

    v_ticket_ids := array_append(v_ticket_ids, v_ticket_id);
  END LOOP;

  UPDATE public.events
  SET available_tickets = available_tickets - p_quantity,
      sold_tickets = COALESCE(sold_tickets, 0) + p_quantity
  WHERE id = p_event_id;

  IF p_ticket_type_id IS NOT NULL THEN
    UPDATE public.event_ticket_types
    SET sold = COALESCE(sold, 0) + p_quantity
    WHERE id = p_ticket_type_id;
  END IF;

  SELECT * INTO v_event
  FROM public.events
  WHERE id = p_event_id;

  v_data := jsonb_build_object(
    'buyer_id', COALESCE(p_user_id::text, ''),
    'name', COALESCE(NULLIF(p_buyer_name, ''), '¡Genial!'),
    'event_id', COALESCE(p_event_id::text, ''),
    'event_title', COALESCE(v_event.title, ''),
    'quantity', GREATEST(p_quantity, 1)::text,
    'payment_intent_id', ''
  );

  BEGIN
    PERFORM public.enqueue_notification_from_template(p_user_id, 'attendee', 'PURCHASE_SUCCESS', v_data);
    PERFORM public.enqueue_notification_from_template(p_user_id, 'attendee', 'purchase_completed', v_data);
  EXCEPTION WHEN others THEN
    NULL;
  END;

  IF v_event.creator_id IS NOT NULL THEN
    BEGIN
      PERFORM public.enqueue_notification_from_template(v_event.creator_id, 'organizer', 'NEW_SALE', v_data);
      PERFORM public.enqueue_notification_from_template(v_event.creator_id, 'organizer', 'organizer_realtime_sale', v_data);
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END IF;

  RETURN json_build_object('success', true, 'ticket_ids', v_ticket_ids);
END;
$$;

GRANT EXECUTE ON FUNCTION public.buy_ticket_with_credito(uuid, uuid, text, text, int, numeric, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.buy_vip_with_credito(
  p_vip_reservado_id uuid,
  p_user_id uuid,
  p_buyer_name text,
  p_buyer_email text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_vip public.reservados_vip%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_price numeric;
  v_ticket_id uuid;
  v_data jsonb;
BEGIN
  IF p_vip_reservado_id IS NULL THEN
    RAISE EXCEPTION 'VIP not found';
  END IF;

  SELECT * INTO v_vip
  FROM public.reservados_vip
  WHERE id = p_vip_reservado_id
  FOR UPDATE;

  IF v_vip IS NULL OR COALESCE(v_vip.quantity_available, 0) < 1 THEN
    RAISE EXCEPTION 'VIP sold out';
  END IF;

  v_price := ROUND(COALESCE(v_vip.base_price, 0)::numeric, 2);
  IF v_price <= 0 THEN
    RAISE EXCEPTION 'Invalid price';
  END IF;

  PERFORM public.apply_credito_delta(p_user_id, -v_price, 'compra_con_credito', NULL, 'Compra VIP con crédito (sin Stripe)');

  UPDATE public.reservados_vip
  SET quantity_available = quantity_available - 1
  WHERE id = v_vip.id;

  INSERT INTO public.tickets (
    event_id,
    user_id,
    buyer_name,
    buyer_email,
    quantity,
    qr_token,
    qr_code,
    ticket_type_id,
    total_price,
    status,
    ticket_status
  )
  VALUES (
    v_vip.event_id,
    p_user_id,
    p_buyer_name,
    p_buyer_email,
    GREATEST(COALESCE(v_vip.capacity_people, 1), 1),
    gen_random_uuid(),
    gen_random_uuid()::text,
    NULL,
    v_price,
    'valid',
    'active'
  )
  RETURNING id INTO v_ticket_id;

  SELECT * INTO v_event
  FROM public.events
  WHERE id = v_vip.event_id;

  v_data := jsonb_build_object(
    'buyer_id', COALESCE(p_user_id::text, ''),
    'name', COALESCE(NULLIF(p_buyer_name, ''), '¡Genial!'),
    'event_id', COALESCE(v_vip.event_id::text, ''),
    'event_title', COALESCE(v_event.title, ''),
    'quantity', '1',
    'ticket_id', COALESCE(v_ticket_id::text, ''),
    'payment_intent_id', ''
  );

  BEGIN
    PERFORM public.enqueue_notification_from_template(p_user_id, 'attendee', 'PURCHASE_SUCCESS', v_data);
    PERFORM public.enqueue_notification_from_template(p_user_id, 'attendee', 'purchase_completed', v_data);
  EXCEPTION WHEN others THEN
    NULL;
  END;

  IF v_event.creator_id IS NOT NULL THEN
    BEGIN
      PERFORM public.enqueue_notification_from_template(v_event.creator_id, 'organizer', 'NEW_SALE', v_data);
      PERFORM public.enqueue_notification_from_template(v_event.creator_id, 'organizer', 'organizer_realtime_sale', v_data);
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END IF;

  RETURN json_build_object('success', true, 'ticket_id', v_ticket_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.buy_vip_with_credito(uuid, uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.buy_resale_ticket_with_credito(
  p_listing_id uuid,
  p_buyer_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_listing public.resale_listings%ROWTYPE;
  v_ticket public.tickets%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_commission numeric;
  v_seller_amount numeric;
  v_data jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF auth.uid() IS DISTINCT FROM p_buyer_id THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  IF p_listing_id IS NULL THEN
    RAISE EXCEPTION 'Listing not found';
  END IF;

  SELECT * INTO v_listing
  FROM public.resale_listings
  WHERE id = p_listing_id
  FOR UPDATE;

  IF v_listing IS NULL OR v_listing.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Listing not active';
  END IF;

  IF v_listing.seller_id IS DISTINCT FROM NULL AND v_listing.seller_id = p_buyer_id THEN
    RAISE EXCEPTION 'Cannot buy own listing';
  END IF;

  v_commission := ROUND((v_listing.price * 0.12)::numeric, 2);
  v_seller_amount := ROUND((v_listing.price - v_commission)::numeric, 2);

  PERFORM public.apply_credito_delta(p_buyer_id, -ROUND(v_listing.price::numeric, 2), 'compra_con_credito', p_listing_id::text, 'Compra reventa con crédito (sin Stripe)');
  PERFORM public.apply_credito_delta(v_listing.seller_id, v_seller_amount, 'generacion_credito_reventa', p_listing_id::text, 'Crédito generado por reventa');
  PERFORM public.record_ledger_movimiento('comision_plataforma', NULL, NULL, v_commission, p_listing_id::text, 'Comisión plataforma reventa');

  UPDATE public.tickets
  SET
    user_id = p_buyer_id,
    status = 'valid',
    ticket_status = 'active',
    qr_token = gen_random_uuid(),
    qr_code = gen_random_uuid()::text,
    transfer_count = COALESCE(transfer_count, 0) + 1,
    last_transferred_at = now()
  WHERE id = v_listing.ticket_id;

  UPDATE public.resale_listings
  SET status = 'sold', updated_at = now()
  WHERE id = v_listing.id;

  INSERT INTO public.resale_transactions (listing_id, ticket_id, seller_id, buyer_id, price, commission, seller_amount)
  VALUES (v_listing.id, v_listing.ticket_id, v_listing.seller_id, p_buyer_id, v_listing.price, v_commission, v_seller_amount);

  SELECT * INTO v_ticket
  FROM public.tickets
  WHERE id = v_listing.ticket_id;

  IF v_ticket.id IS NOT NULL THEN
    SELECT * INTO v_event
    FROM public.events
    WHERE id = v_ticket.event_id;
  END IF;

  v_data := jsonb_build_object(
    'buyer_id', COALESCE(p_buyer_id::text, ''),
    'seller_id', COALESCE(v_listing.seller_id::text, ''),
    'event_id', COALESCE(v_ticket.event_id::text, ''),
    'event_title', COALESCE(v_event.title, ''),
    'quantity', '1',
    'ticket_id', COALESCE(v_listing.ticket_id::text, ''),
    'listing_id', COALESCE(v_listing.id::text, ''),
    'payment_intent_id', ''
  );

  BEGIN
    PERFORM public.enqueue_notification_from_template(p_buyer_id, 'attendee', 'PURCHASE_SUCCESS', v_data);
    PERFORM public.enqueue_notification_from_template(p_buyer_id, 'attendee', 'purchase_completed', v_data);
  EXCEPTION WHEN others THEN
    NULL;
  END;

  IF v_listing.seller_id IS NOT NULL AND v_listing.seller_id IS DISTINCT FROM p_buyer_id THEN
    BEGIN
      PERFORM public.enqueue_notification_from_template(v_listing.seller_id, 'attendee', 'RESALE_SUCCESS', v_data);
      PERFORM public.enqueue_notification_from_template(v_listing.seller_id, 'attendee', 'resale_sold', v_data);
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END IF;

  IF v_event.creator_id IS NOT NULL THEN
    BEGIN
      PERFORM public.enqueue_notification_from_template(v_event.creator_id, 'organizer', 'NEW_SALE', v_data);
      PERFORM public.enqueue_notification_from_template(v_event.creator_id, 'organizer', 'organizer_realtime_sale', v_data);
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END IF;

  RETURN jsonb_build_object('success', true, 'listing_id', v_listing.id, 'ticket_id', v_listing.ticket_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.buy_resale_ticket_with_credito(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.calcular_dinero_real_plataforma()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total_cobrado_cents bigint;
  v_creditos_total numeric;
  v_pendiente_organizadores numeric;
  v_sin_destino_cents bigint;
  v_pagos_organizador numeric;
BEGIN
  SELECT COALESCE(SUM(
    CASE
      WHEN status = 'fulfilled' AND destination_account_id IS NOT NULL THEN platform_fee_cents
      WHEN status = 'fulfilled' AND destination_account_id IS NULL THEN amount_cents
      ELSE 0
    END
  ), 0) INTO v_total_cobrado_cents
  FROM public.payment_transactions;

  SELECT COALESCE(SUM(saldo_credito), 0) INTO v_creditos_total
  FROM public.creditos_usuario;

  SELECT COALESCE(SUM(
    CASE
      WHEN status = 'fulfilled' AND destination_account_id IS NULL AND kind IN ('event_ticket','vip_table') THEN amount_cents
      ELSE 0
    END
  ), 0) INTO v_sin_destino_cents
  FROM public.payment_transactions;

  SELECT COALESCE(SUM(importe), 0) INTO v_pagos_organizador
  FROM public.ledger_movimientos
  WHERE tipo = 'pago_organizador';

  v_pendiente_organizadores := GREATEST(ROUND((v_sin_destino_cents::numeric / 100)::numeric, 2) - v_pagos_organizador, 0);

  RETURN jsonb_build_object(
    'total_cobrado_stripe', ROUND((v_total_cobrado_cents::numeric / 100)::numeric, 2),
    'creditos_usuarios', v_creditos_total,
    'pagos_pendientes_organizadores', v_pendiente_organizadores,
    'dinero_real_plataforma', ROUND((v_total_cobrado_cents::numeric / 100)::numeric, 2) - v_creditos_total - v_pendiente_organizadores
  );
END;
$$;

REVOKE ALL ON FUNCTION public.calcular_dinero_real_plataforma() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.calcular_dinero_real_plataforma() TO service_role;

INSERT INTO public.creditos_usuario (usuario_id, saldo_credito)
SELECT w.user_id, ROUND(w.balance::numeric, 2)
FROM public.wallets w
ON CONFLICT (usuario_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
