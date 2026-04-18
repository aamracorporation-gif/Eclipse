-- Create wallets table
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
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'wallets'
      AND policyname = 'Users can view their own wallet'
  ) THEN
    CREATE POLICY "Users can view their own wallet"
      ON wallets FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;

-- Create wallet transactions table for history
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
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'wallet_transactions'
      AND policyname = 'Users can view their own transactions'
  ) THEN
    CREATE POLICY "Users can view their own transactions"
      ON wallet_transactions FOR SELECT
      TO authenticated
      USING (wallet_id IN (SELECT id FROM wallets WHERE user_id = auth.uid()));
  END IF;
END $$;

-- Create resale_listings table
CREATE TABLE IF NOT EXISTS resale_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid REFERENCES tickets(id) ON DELETE CASCADE NOT NULL UNIQUE,
  seller_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  price numeric NOT NULL CHECK (price > 0),
  status text DEFAULT 'active' CHECK (status IN ('active', 'sold', 'cancelled')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS for resale listings
ALTER TABLE resale_listings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'resale_listings'
      AND policyname = 'Anyone can view active resale listings'
  ) THEN
    CREATE POLICY "Anyone can view active resale listings"
      ON resale_listings FOR SELECT
      USING (status = 'active');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'resale_listings'
      AND policyname = 'Users can view their own listings'
  ) THEN
    CREATE POLICY "Users can view their own listings"
      ON resale_listings FOR SELECT
      TO authenticated
      USING (auth.uid() = seller_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'resale_listings'
      AND policyname = 'Users can create resale listings for their tickets'
  ) THEN
    CREATE POLICY "Users can create resale listings for their tickets"
      ON resale_listings FOR INSERT
      TO authenticated
      WITH CHECK (
        auth.uid() = seller_id AND
        EXISTS (SELECT 1 FROM tickets WHERE id = ticket_id AND user_id = auth.uid())
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'resale_listings'
      AND policyname = 'Users can update their own listings'
  ) THEN
    CREATE POLICY "Users can update their own listings"
      ON resale_listings FOR UPDATE
      TO authenticated
      USING (auth.uid() = seller_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'resale_listings'
      AND policyname = 'Users can delete their own listings'
  ) THEN
    CREATE POLICY "Users can delete their own listings"
      ON resale_listings FOR DELETE
      TO authenticated
      USING (auth.uid() = seller_id);
  END IF;
END $$;

-- Add status column to tickets if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tickets' AND column_name = 'status'
  ) THEN
    ALTER TABLE tickets ADD COLUMN status text DEFAULT 'valid' CHECK (status IN ('valid', 'resale', 'used', 'cancelled'));
  END IF;
END $$;

-- Function to handle buying a resale ticket
CREATE OR REPLACE FUNCTION buy_resale_ticket(
  p_listing_id uuid,
  p_buyer_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_listing resale_listings%ROWTYPE;
  v_buyer_wallet wallets%ROWTYPE;
  v_seller_wallet wallets%ROWTYPE;
  v_ticket_id uuid;
BEGIN
  -- 1. Get listing info and lock row
  SELECT * INTO v_listing
  FROM resale_listings
  WHERE id = p_listing_id AND status = 'active'
  FOR UPDATE;

  IF v_listing IS NULL THEN
    RAISE EXCEPTION 'Listing not found or not active';
  END IF;

  v_ticket_id := v_listing.ticket_id;

  -- 2. Check if buyer is not seller
  IF v_listing.seller_id = p_buyer_id THEN
    RAISE EXCEPTION 'Cannot buy your own ticket';
  END IF;

  -- 3. Check buyer wallet balance
  SELECT * INTO v_buyer_wallet
  FROM wallets
  WHERE user_id = p_buyer_id
  FOR UPDATE;

  IF v_buyer_wallet IS NULL THEN
    -- Auto-create wallet if missing
    INSERT INTO wallets (user_id, balance) VALUES (p_buyer_id, 0) RETURNING * INTO v_buyer_wallet;
  END IF;

  IF v_buyer_wallet.balance < v_listing.price THEN
    RAISE EXCEPTION 'Insufficient funds in wallet';
  END IF;

  -- 4. Get Seller Wallet (create if missing)
  SELECT * INTO v_seller_wallet
  FROM wallets
  WHERE user_id = v_listing.seller_id
  FOR UPDATE;

  IF v_seller_wallet IS NULL THEN
    INSERT INTO wallets (user_id, balance) VALUES (v_listing.seller_id, 0) RETURNING * INTO v_seller_wallet;
  END IF;

  -- 5. PROCESS TRANSACTION

  -- Deduct from Buyer
  UPDATE wallets SET balance = balance - v_listing.price WHERE id = v_buyer_wallet.id;
  INSERT INTO wallet_transactions (wallet_id, amount, type, description, reference_id)
  VALUES (v_buyer_wallet.id, v_listing.price, 'debit', 'Purchase resale ticket', v_ticket_id);

  -- Add to Seller
  UPDATE wallets SET balance = balance + v_listing.price WHERE id = v_seller_wallet.id;
  INSERT INTO wallet_transactions (wallet_id, amount, type, description, reference_id)
  VALUES (v_seller_wallet.id, v_listing.price, 'credit', 'Sold ticket', v_ticket_id);

  -- 6. Transfer Ticket Ownership
  UPDATE tickets
  SET 
    user_id = p_buyer_id,
    status = 'valid', -- Reset status from 'resale' to 'valid'
    qr_code = 'TICKET-RESALE-' || v_ticket_id || '-' || extract(epoch from now())::text -- Regenerate QR to invalidate old screenshot
  WHERE id = v_ticket_id;

  -- 7. Update Listing Status
  UPDATE resale_listings
  SET status = 'sold', updated_at = now()
  WHERE id = p_listing_id;

  RETURN json_build_object('success', true, 'ticket_id', v_ticket_id);
END;
$$;

-- Function to create a wallet for a user if it doesn't exist
CREATE OR REPLACE FUNCTION ensure_wallet_exists(p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
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
