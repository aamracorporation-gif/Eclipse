-- 1. Create wallets table (IF NOT EXISTS)
CREATE TABLE IF NOT EXISTS wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  balance numeric DEFAULT 0.00 CHECK (balance >= 0),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS for wallets
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'wallets' AND policyname = 'Users can view their own wallet'
  ) THEN
    CREATE POLICY "Users can view their own wallet"
      ON wallets FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;

-- 2. Create wallet transactions table (IF NOT EXISTS)
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id uuid REFERENCES wallets(id) ON DELETE CASCADE NOT NULL,
  amount numeric NOT NULL,
  type text CHECK (type IN ('credit', 'debit')) NOT NULL,
  description text,
  reference_id uuid, -- Can be ticket_id or null
  created_at timestamptz DEFAULT now()
);

-- Enable RLS for transactions
ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'wallet_transactions' AND policyname = 'Users can view their own transactions'
  ) THEN
    CREATE POLICY "Users can view their own transactions"
      ON wallet_transactions FOR SELECT
      TO authenticated
      USING (wallet_id IN (SELECT id FROM wallets WHERE user_id = auth.uid()));
  END IF;
END $$;

-- 3. Update purchase_ticket to loop and insert individual tickets
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
AS $$
DECLARE
  v_event_available integer;
  v_ticket_type_available integer;
  v_ticket_id uuid;
  v_ticket_ids uuid[];
  i integer;
  v_single_price numeric;
BEGIN
  -- Check event availability with LOCK
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

  -- Check ticket type availability (if specified) with LOCK
  IF p_ticket_type_id IS NOT NULL THEN
    SELECT quantity - COALESCE(sold, 0) INTO v_ticket_type_available
    FROM event_ticket_types
    WHERE id = p_ticket_type_id
    FOR UPDATE;
    
    IF v_ticket_type_available IS NULL OR v_ticket_type_available < p_quantity THEN
        RAISE EXCEPTION 'Not enough tickets of this type available';
    END IF;
  END IF;

  -- Calculate price per ticket for individual records
  v_single_price := p_total_price / p_quantity;

  -- Update event stats ONCE
  UPDATE events
  SET 
    available_tickets = available_tickets - p_quantity,
    sold_tickets = COALESCE(sold_tickets, 0) + p_quantity
  WHERE id = p_event_id;

  -- Update ticket type stats ONCE (if specified)
  IF p_ticket_type_id IS NOT NULL THEN
    UPDATE event_ticket_types
    SET sold = COALESCE(sold, 0) + p_quantity
    WHERE id = p_ticket_type_id;
  END IF;

  -- Insert tickets in a loop
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
      1, -- Always 1 per row
      v_single_price, 
      p_qr_code || '-' || i, -- Unique QR
      p_ticket_type_id,
      now(),
      'valid'
    )
    RETURNING id INTO v_ticket_id;
    
    v_ticket_ids := array_append(v_ticket_ids, v_ticket_id);
  END LOOP;

  -- Return list of IDs
  RETURN json_build_object('ticket_ids', v_ticket_ids);
END;
$$;

-- 4. Update buy_ticket_with_wallet to handle the new return format
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
  -- Check Wallet Balance
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

  -- Call purchase_ticket
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

  -- Extract first ticket ID for reference
  v_first_id := (v_result->'ticket_ids'->>0);

  -- Deduct from Wallet
  UPDATE wallets
  SET balance = balance - p_total_price, updated_at = now()
  WHERE id = v_wallet.id;

  -- Record Transaction
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
