-- Script de Reparación Completo: Estructura, Tablas y Funciones
-- Ejecuta esto para solucionar TODOS los errores de tablas faltantes y columnas inexistentes.

-- 1. Asegurar que la tabla 'event_ticket_types' existe (Dependencia de tickets)
CREATE TABLE IF NOT EXISTS event_ticket_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES events(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  price numeric NOT NULL CHECK (price >= 0),
  quantity integer NOT NULL CHECK (quantity >= 0),
  sold integer DEFAULT 0 CHECK (sold >= 0),
  description text,
  created_at timestamptz DEFAULT now()
);

-- 2. Asegurar que la tabla 'tickets' tiene la columna 'ticket_type_id' y 'status'
-- (Soluciona error: column "ticket_type_id" does not exist)
DO $$
BEGIN
  -- Añadir ticket_type_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tickets' AND column_name = 'ticket_type_id'
  ) THEN
    ALTER TABLE tickets ADD COLUMN ticket_type_id uuid REFERENCES event_ticket_types(id);
  END IF;

  -- Añadir status
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tickets' AND column_name = 'status'
  ) THEN
    ALTER TABLE tickets ADD COLUMN status text DEFAULT 'valid' CHECK (status IN ('valid', 'resale', 'used', 'cancelled'));
  END IF;
END $$;

-- 3. Asegurar que la tabla 'wallets' existe (Soluciona error: relation "wallets" does not exist)
CREATE TABLE IF NOT EXISTS wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  balance numeric DEFAULT 0.00 CHECK (balance >= 0),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'wallets' AND policyname = 'Users can view their own wallet') THEN
    CREATE POLICY "Users can view their own wallet" ON wallets FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
END $$;

-- 4. Asegurar que la tabla 'wallet_transactions' existe
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id uuid REFERENCES wallets(id) ON DELETE CASCADE NOT NULL,
  amount numeric NOT NULL,
  type text CHECK (type IN ('credit', 'debit')) NOT NULL,
  description text,
  reference_id uuid,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'wallet_transactions' AND policyname = 'Users can view their own transactions') THEN
    CREATE POLICY "Users can view their own transactions" ON wallet_transactions FOR SELECT TO authenticated USING (wallet_id IN (SELECT id FROM wallets WHERE user_id = auth.uid()));
  END IF;
END $$;

-- 5. Asegurar que la tabla 'resale_listings' existe (Soluciona error: relation "public.resale_listings" does not exist)
CREATE TABLE IF NOT EXISTS resale_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid REFERENCES tickets(id) ON DELETE CASCADE NOT NULL UNIQUE,
  seller_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  price numeric NOT NULL CHECK (price > 0),
  status text DEFAULT 'active' CHECK (status IN ('active', 'sold', 'cancelled')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE resale_listings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'resale_listings' AND policyname = 'Anyone can view active resale listings') THEN
    CREATE POLICY "Anyone can view active resale listings" ON resale_listings FOR SELECT USING (status = 'active');
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'resale_listings' AND policyname = 'Users can view their own listings') THEN
    CREATE POLICY "Users can view their own listings" ON resale_listings FOR SELECT TO authenticated USING (auth.uid() = seller_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'resale_listings' AND policyname = 'Users can create resale listings for their tickets') THEN
    CREATE POLICY "Users can create resale listings for their tickets" ON resale_listings FOR INSERT TO authenticated WITH CHECK (auth.uid() = seller_id AND EXISTS (SELECT 1 FROM tickets WHERE id = ticket_id AND user_id = auth.uid()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'resale_listings' AND policyname = 'Users can update their own listings') THEN
    CREATE POLICY "Users can update their own listings" ON resale_listings FOR UPDATE TO authenticated USING (auth.uid() = seller_id);
  END IF;
END $$;


-- 6. Función para crear cartera si no existe (Soluciona error: Could not find function ensure_wallet_exists)
CREATE OR REPLACE FUNCTION ensure_wallet_exists(p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_wallet_id uuid;
BEGIN
  INSERT INTO wallets (user_id, balance)
  VALUES (p_user_id, 0)
  ON CONFLICT (user_id) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_wallet_id;
  
  RETURN json_build_object('wallet_id', v_wallet_id);
END;
$$;

REVOKE ALL ON FUNCTION ensure_wallet_exists(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ensure_wallet_exists(uuid) TO service_role;

-- 7. Función de compra actualizada (Lógica de entradas individuales + Bloqueo Estricto)
CREATE OR REPLACE FUNCTION purchase_ticket(
  p_event_id uuid,
  p_user_id uuid,
  p_buyer_name text,
  p_buyer_email text,
  p_quantity integer,
  p_total_price numeric,
  p_qr_code text,
  p_ticket_type_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event_available integer;
  v_ticket_type_available integer;
  v_ticket_id uuid;
  v_ticket_ids uuid[];
  i integer;
  v_single_price numeric;
BEGIN
  -- Verificar disponibilidad de evento
  SELECT available_tickets INTO v_event_available
  FROM events
  WHERE id = p_event_id
  FOR UPDATE;

  IF v_event_available IS NULL THEN
    RAISE EXCEPTION 'Event not found';
  END IF;

  IF v_event_available < p_quantity THEN
    RAISE EXCEPTION 'Not enough tickets available in event';
  END IF;

  -- Verificar disponibilidad de tipo de ticket
  IF p_ticket_type_id IS NOT NULL THEN
    -- Obtenemos cantidad total y vendida con bloqueo
    SELECT quantity - COALESCE(sold, 0) INTO v_ticket_type_available
    FROM event_ticket_types
    WHERE id = p_ticket_type_id
    FOR UPDATE;
    
    IF v_ticket_type_available IS NULL THEN
         RAISE EXCEPTION 'Ticket type not found';
    END IF;

    -- Validacion estricta: Si lo disponible es menor que lo solicitado
    IF v_ticket_type_available < p_quantity THEN
        RAISE EXCEPTION 'Not enough tickets of this type available. Only % left.', v_ticket_type_available;
    END IF;
  END IF;

  -- Calcular precio individual
  v_single_price := p_total_price / p_quantity;

  -- Actualizar evento
  UPDATE events
  SET 
    available_tickets = available_tickets - p_quantity,
    sold_tickets = COALESCE(sold_tickets, 0) + p_quantity
  WHERE id = p_event_id;

  -- Actualizar tipo de ticket
  IF p_ticket_type_id IS NOT NULL THEN
    UPDATE event_ticket_types
    SET sold = COALESCE(sold, 0) + p_quantity
    WHERE id = p_ticket_type_id;
  END IF;

  -- Insertar tickets individualmente
  v_ticket_ids := ARRAY[]::uuid[];
  
  FOR i IN 1..p_quantity LOOP
    INSERT INTO tickets (
      event_id, 
      user_id, 
      buyer_name, 
      buyer_email, 
      quantity, 
      total_price, 
      qr_code,
      ticket_type_id,
      purchase_date,
      status
    )
    VALUES (
      p_event_id, 
      p_user_id, 
      p_buyer_name, 
      p_buyer_email, 
      1, 
      v_single_price, 
      p_qr_code || '-' || i,
      p_ticket_type_id,
      now(),
      'valid'
    )
    RETURNING id INTO v_ticket_id;
    
    v_ticket_ids := array_append(v_ticket_ids, v_ticket_id);
  END LOOP;

  RETURN json_build_object('ticket_ids', v_ticket_ids);
END;
$$;

REVOKE ALL ON FUNCTION purchase_ticket(uuid, uuid, text, text, integer, numeric, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION purchase_ticket(uuid, uuid, text, text, integer, numeric, text, uuid) TO service_role;

-- 8. Función de compra con wallet actualizada
CREATE OR REPLACE FUNCTION buy_ticket_with_wallet(
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
  v_wallet wallets%ROWTYPE;
  v_result json;
  v_first_id text;
BEGIN
  -- Verificar Wallet
  SELECT * INTO v_wallet
  FROM wallets
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF v_wallet IS NULL THEN
    INSERT INTO wallets (user_id, balance) VALUES (p_user_id, 0) RETURNING * INTO v_wallet;
  END IF;

  IF v_wallet.balance < p_total_price THEN
    RAISE EXCEPTION 'Insufficient funds in wallet';
  END IF;

  -- Llamar a purchase_ticket
  SELECT purchase_ticket(
    p_event_id,
    p_user_id,
    p_buyer_name,
    p_buyer_email,
    p_quantity,
    p_total_price,
    p_qr_code,
    p_ticket_type_id
  ) INTO v_result;

  v_first_id := (v_result->'ticket_ids'->>0);

  -- Descontar saldo
  UPDATE wallets
  SET balance = balance - p_total_price, updated_at = now()
  WHERE id = v_wallet.id;

  -- Registrar transacción
  INSERT INTO wallet_transactions (wallet_id, amount, type, description, reference_id)
  VALUES (
    v_wallet.id, 
    p_total_price, 
    'debit', 
    'Purchase ' || p_quantity || ' ticket(s)', 
    v_first_id::uuid
  );

  RETURN v_result;
END;
$$;

-- 9. Función de añadir fondos
CREATE OR REPLACE FUNCTION add_funds(
  p_user_id uuid,
  p_amount numeric
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_wallet wallets%ROWTYPE;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  SELECT * INTO v_wallet
  FROM wallets
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF v_wallet IS NULL THEN
    INSERT INTO wallets (user_id, balance) VALUES (p_user_id, 0) RETURNING * INTO v_wallet;
  END IF;

  UPDATE wallets
  SET balance = balance + p_amount, updated_at = now()
  WHERE id = v_wallet.id;

  INSERT INTO wallet_transactions (wallet_id, amount, type, description)
  VALUES (v_wallet.id, p_amount, 'credit', 'Recarga de saldo');

  RETURN json_build_object('success', true, 'new_balance', v_wallet.balance + p_amount);
END;
$$;

-- 10. Sincronización de Datos (FIX IMPORTANTE)
-- Recalcula los contadores de ventas basándose en las entradas reales existentes
-- Esto corrige cualquier desajuste previo donde se permitía sobreventa

UPDATE event_ticket_types ett
SET sold = (
    SELECT COALESCE(SUM(quantity), 0)
    FROM tickets t
    WHERE t.ticket_type_id = ett.id
);

UPDATE events e
SET sold_tickets = (
    SELECT COALESCE(SUM(quantity), 0)
    FROM tickets t
    WHERE t.event_id = e.id
);
