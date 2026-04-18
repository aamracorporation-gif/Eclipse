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
  -- Check amount
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  -- Get Wallet
  SELECT * INTO v_wallet
  FROM wallets
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF v_wallet IS NULL THEN
    INSERT INTO wallets (user_id, balance) VALUES (p_user_id, 0) RETURNING * INTO v_wallet;
  END IF;

  -- Add Funds
  UPDATE wallets
  SET balance = balance + p_amount, updated_at = now()
  WHERE id = v_wallet.id;

  -- Record Transaction
  INSERT INTO wallet_transactions (wallet_id, amount, type, description)
  VALUES (v_wallet.id, p_amount, 'credit', 'Recarga de saldo');

  RETURN json_build_object('success', true, 'new_balance', v_wallet.balance + p_amount);
END;
$$;
