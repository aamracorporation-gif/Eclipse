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

GRANT EXECUTE ON FUNCTION public.buy_resale_ticket(uuid, uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';

