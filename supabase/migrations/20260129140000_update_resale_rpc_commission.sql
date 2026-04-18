-- Update buy_resale_ticket function to include commission logic
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
  v_commission numeric;
  v_seller_amount numeric;
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

  -- 5. CALCULATE COMMISSION (10%)
  v_commission := v_listing.price * 0.10;
  v_seller_amount := v_listing.price - v_commission;

  -- 6. PROCESS TRANSACTION

  -- Deduct FULL PRICE from Buyer
  UPDATE wallets SET balance = balance - v_listing.price WHERE id = v_buyer_wallet.id;
  INSERT INTO wallet_transactions (wallet_id, amount, type, description, reference_id)
  VALUES (v_buyer_wallet.id, v_listing.price, 'debit', 'Purchase resale ticket', v_ticket_id);

  -- Add NET AMOUNT (Price - Commission) to Seller
  UPDATE wallets SET balance = balance + v_seller_amount WHERE id = v_seller_wallet.id;
  INSERT INTO wallet_transactions (wallet_id, amount, type, description, reference_id)
  VALUES (v_seller_wallet.id, v_seller_amount, 'credit', 'Sold ticket (less 10% commission)', v_ticket_id);

  -- 7. Transfer Ticket Ownership and regenerate secure QR
  UPDATE tickets
  SET 
    user_id = p_buyer_id,
    status = 'valid', -- Reset status from 'resale' to 'valid'
    qr_token = gen_random_uuid(), -- New secure token (invalidates previous QR)
    qr_code = gen_random_uuid()::text, -- Keep qr_code in sync as a fresh UUID string
    transfer_count = COALESCE(transfer_count, 0) + 1,
    last_transferred_at = now()
  WHERE id = v_ticket_id;

  -- 8. Update Listing Status
  UPDATE resale_listings
  SET status = 'sold', updated_at = now()
  WHERE id = p_listing_id;

  RETURN json_build_object(
    'success', true, 
    'ticket_id', v_ticket_id, 
    'commission', v_commission,
    'seller_amount', v_seller_amount
  );
END;
$$;
