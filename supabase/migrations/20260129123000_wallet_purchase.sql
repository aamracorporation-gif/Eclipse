-- Function to buy ticket using wallet balance
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
SET search_path = public, pg_temp
AS $$
DECLARE
  v_wallet wallets%ROWTYPE;
  v_result json;
BEGIN
  -- 1. Check Wallet Balance
  SELECT * INTO v_wallet
  FROM wallets
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF v_wallet IS NULL THEN
    -- Try to create wallet
    INSERT INTO wallets (user_id, balance) VALUES (p_user_id, 0) RETURNING * INTO v_wallet;
  END IF;

  IF v_wallet.balance < p_total_price THEN
    RAISE EXCEPTION 'Insufficient funds in wallet';
  END IF;

  -- 2. Call purchase_ticket
  -- We rely on the existing purchase_ticket function to handle inventory and ticket creation
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

  -- 3. Deduct from Wallet
  UPDATE wallets
  SET balance = balance - p_total_price, updated_at = now()
  WHERE id = v_wallet.id;

  -- 4. Record Transaction
  INSERT INTO wallet_transactions (wallet_id, amount, type, description, reference_id)
  VALUES (v_wallet.id, p_total_price, 'debit', 'Event ticket purchase', NULL); -- We might not have easy access to ticket ID if purchase_ticket returns generic success, but usually it returns json.

  RETURN v_result;
END;
$$;

-- Legacy implementation: only trusted server code may call it. Newer wallet
-- purchase functions validate ownership and pricing before any mutation.
REVOKE ALL ON FUNCTION buy_ticket_with_wallet(uuid, uuid, text, text, integer, numeric, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION buy_ticket_with_wallet(uuid, uuid, text, text, integer, numeric, text, uuid) TO service_role;
