DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tickets' AND column_name = 'qr_token'
  ) THEN
    ALTER TABLE public.tickets ADD COLUMN qr_token uuid DEFAULT gen_random_uuid();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tickets' AND column_name = 'transfer_count'
  ) THEN
    ALTER TABLE public.tickets ADD COLUMN transfer_count integer NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tickets' AND column_name = 'last_transferred_at'
  ) THEN
    ALTER TABLE public.tickets ADD COLUMN last_transferred_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tickets' AND column_name = 'ticket_status'
  ) THEN
    ALTER TABLE public.tickets ADD COLUMN ticket_status text DEFAULT 'active';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tickets_ticket_status_check'
  ) THEN
    ALTER TABLE public.tickets
    ADD CONSTRAINT tickets_ticket_status_check
    CHECK (ticket_status IN ('active', 'used', 'reselling', 'sold', 'invalidated'));
  END IF;
END $$;

UPDATE public.tickets
SET ticket_status = COALESCE(ticket_status,
  CASE
    WHEN status = 'used' OR validation_status = 'used' OR scanned_at IS NOT NULL THEN 'used'
    WHEN status = 'resale' THEN 'reselling'
    WHEN status = 'cancelled' THEN 'invalidated'
    ELSE 'active'
  END
);

CREATE INDEX IF NOT EXISTS idx_tickets_qr_token ON public.tickets(qr_token);
CREATE INDEX IF NOT EXISTS idx_tickets_ticket_status ON public.tickets(ticket_status);

CREATE TABLE IF NOT EXISTS public.resale_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid REFERENCES public.resale_listings(id) ON DELETE SET NULL,
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  buyer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  price numeric NOT NULL CHECK (price > 0),
  commission numeric NOT NULL DEFAULT 0 CHECK (commission >= 0),
  seller_amount numeric NOT NULL DEFAULT 0 CHECK (seller_amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.resale_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their resale transactions" ON public.resale_transactions;
CREATE POLICY "Users can read their resale transactions"
ON public.resale_transactions
FOR SELECT
TO authenticated
USING (auth.uid() = seller_id OR auth.uid() = buyer_id);

CREATE INDEX IF NOT EXISTS idx_resale_transactions_seller_id_created_at ON public.resale_transactions(seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_resale_transactions_buyer_id_created_at ON public.resale_transactions(buyer_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.create_resale_listing_secure(
  p_ticket_id uuid,
  p_price numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ticket public.tickets%ROWTYPE;
  v_existing public.resale_listings%ROWTYPE;
  v_listing_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
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

  IF p_price > v_ticket.total_price THEN
    RAISE EXCEPTION 'Resale price cannot exceed original price';
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
  RETURNING id INTO v_listing_id;

  RETURN jsonb_build_object('listing_id', v_listing_id, 'ticket_id', p_ticket_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_resale_listing_secure(
  p_ticket_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_listing public.resale_listings%ROWTYPE;
  v_ticket public.tickets%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_listing
  FROM public.resale_listings
  WHERE ticket_id = p_ticket_id AND status = 'active'
  FOR UPDATE;

  IF v_listing IS NULL THEN
    RAISE EXCEPTION 'No active listing found';
  END IF;

  IF v_listing.seller_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not the seller';
  END IF;

  SELECT * INTO v_ticket
  FROM public.tickets
  WHERE id = p_ticket_id
  FOR UPDATE;

  DELETE FROM public.resale_listings
  WHERE id = v_listing.id;

  UPDATE public.tickets
  SET status = 'valid',
      ticket_status = 'active'
  WHERE id = p_ticket_id
    AND user_id = auth.uid();

  RETURN jsonb_build_object('success', true, 'ticket_id', p_ticket_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.buy_resale_ticket(
  p_listing_id uuid,
  p_buyer_id uuid
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

  IF v_listing.price > v_ticket.total_price THEN
    RAISE EXCEPTION 'Resale price cannot exceed original price';
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

  UPDATE public.wallets SET balance = balance - v_listing.price WHERE id = v_buyer_wallet.id;
  INSERT INTO public.wallet_transactions (wallet_id, amount, type, description, reference_id)
  VALUES (v_buyer_wallet.id, v_listing.price, 'debit', 'Purchase resale ticket', v_ticket_id);

  UPDATE public.wallets SET balance = balance + v_seller_amount WHERE id = v_seller_wallet.id;
  INSERT INTO public.wallet_transactions (wallet_id, amount, type, description, reference_id)
  VALUES (v_seller_wallet.id, v_seller_amount, 'credit', 'Sold ticket (less 10% commission)', v_ticket_id);

  UPDATE public.tickets
  SET
    user_id = p_buyer_id,
    status = 'valid',
    ticket_status = 'active',
    qr_token = gen_random_uuid(),
    qr_code = gen_random_uuid()::text,
    transfer_count = COALESCE(transfer_count, 0) + 1,
    last_transferred_at = now()
  WHERE id = v_ticket_id;

  UPDATE public.resale_listings
  SET status = 'sold', updated_at = now()
  WHERE id = p_listing_id;

  INSERT INTO public.resale_transactions (listing_id, ticket_id, seller_id, buyer_id, price, commission, seller_amount)
  VALUES (p_listing_id, v_ticket_id, v_listing.seller_id, p_buyer_id, v_listing.price, v_commission, v_seller_amount);

  RETURN json_build_object(
    'success', true,
    'ticket_id', v_ticket_id,
    'commission', v_commission,
    'seller_amount', v_seller_amount
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_ticket_qr_v2(p_qr_token text, p_scanned_by_text text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ticket record;
  v_event record;
  v_user record;
  v_ticket_info jsonb;
  v_scanner_id uuid;
BEGIN
  BEGIN
    v_scanner_id := p_scanned_by_text::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('valid', false, 'message', 'ID de escáner inválido');
  END;

  SELECT * INTO v_ticket FROM public.tickets
  WHERE qr_token::text = p_qr_token
     OR qr_code = p_qr_token
  LIMIT 1;

  IF v_ticket IS NULL THEN
    -- [NOTIFICACIÓN STAFF] Ticket inválido
    PERFORM public.notify(v_scanner_id, 'staff', 'invalid_ticket', '🚫 Ticket inválido detectado. El código no existe.');
    RETURN jsonb_build_object('valid', false, 'message', 'Entrada no encontrada');
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = v_ticket.event_id;
  SELECT * INTO v_user FROM public.profiles WHERE id = v_ticket.user_id;

  v_ticket_info := jsonb_build_object(
    'id', v_ticket.id,
    'event', v_event.title,
    'owner', v_user.full_name,
    'date', v_event.event_date,
    'scanned_at', v_ticket.scanned_at
  );

  IF v_event.creator_id != v_scanner_id THEN
    -- [NOTIFICACIÓN STAFF] Ticket de otro evento
    PERFORM public.notify(v_scanner_id, 'staff', 'wrong_event', '⚠️ Ticket detectado para otro evento o cuenta.');
    RETURN jsonb_build_object(
      'valid', false,
      'message', 'Esta entrada no pertenece a tus eventos',
      'ticket', v_ticket_info
    );
  END IF;

  -- Check if already scanned
  IF v_ticket.scanned_at IS NOT NULL THEN
    -- [NOTIFICACIÓN CLIENTE] Intento fallido
    PERFORM public.notify(v_ticket.user_id, 'attendee', 'validation_failed', '🚫 Este QR ya fue usado o no es válido. Consulta con el staff para ayudarte.');
    
    -- [NOTIFICACIÓN STAFF/ORGANIZADOR] Uso duplicado
    PERFORM public.notify(v_scanner_id, 'staff', 'duplicate_qr', '🚩 ALERTA: Intento de uso duplicado del mismo QR.');
    PERFORM public.notify(v_event.creator_id, 'organizer', 'security_alert', '🚩 Seguridad: Se ha detectado un intento de entrada duplicada.');

    RETURN jsonb_build_object(
      'valid', false,
      'message', 'ESTA ENTRADA YA FUE ESCANEADA',
      'ticket', v_ticket_info
    );
  END IF;

  -- SUCCESS
  UPDATE public.tickets
  SET scanned_at = now(),
      validation_status = 'used',
      ticket_status = 'used',
      status = 'used'
  WHERE id = v_ticket.id;

  -- [NOTIFICACIÓN CLIENTE] Entrada validada
  PERFORM public.notify(v_ticket.user_id, 'attendee', 'entry_success', '✅ Dentro. Que empiece la experiencia.');

  RETURN jsonb_build_object(
    'valid', true,
    'message', 'ACCESO AUTORIZADO',
    'ticket', jsonb_build_object(
      'id', v_ticket.id,
      'event', v_event.title,
      'owner', v_user.full_name,
      'date', v_event.event_date,
      'scanned_at', now()
    )
  );
END;
$$;

GRANT SELECT ON TABLE public.resale_transactions TO authenticated;
GRANT INSERT ON TABLE public.resale_transactions TO authenticated;

GRANT EXECUTE ON FUNCTION public.create_resale_listing_secure(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_resale_listing_secure(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.buy_resale_ticket(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_ticket_qr_v2(text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
