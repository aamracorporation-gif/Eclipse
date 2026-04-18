CREATE OR REPLACE FUNCTION create_resale_listing(
  p_ticket_id uuid,
  p_seller_id uuid,
  p_price numeric
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ticket_count int;
  v_resale_count int;
BEGIN
  -- 1. Verify ownership and status
  SELECT count(*) INTO v_ticket_count
  FROM tickets
  WHERE id = p_ticket_id 
  AND user_id = p_seller_id
  AND status = 'valid'; -- Only valid tickets can be sold

  IF v_ticket_count = 0 THEN
    RAISE EXCEPTION 'Ticket not found, not owned by user, or not valid for resale';
  END IF;

  -- 2. Check resale limit (Max 3 sold resales for this ticket)
  SELECT count(*) INTO v_resale_count
  FROM resale_listings
  WHERE ticket_id = p_ticket_id
  AND status = 'sold';

  IF v_resale_count >= 3 THEN
    RAISE EXCEPTION 'Esta entrada ha alcanzado el límite máximo de 3 reventas';
  END IF;

  -- 3. Update ticket status
  UPDATE tickets
  SET status = 'resale'
  WHERE id = p_ticket_id;

  -- 4. Create or reactivate listing (one row per ticket_id)
  INSERT INTO resale_listings (ticket_id, seller_id, price, status)
  VALUES (p_ticket_id, p_seller_id, p_price, 'active')
  ON CONFLICT (ticket_id) DO UPDATE
  SET 
    seller_id = EXCLUDED.seller_id,
    price = EXCLUDED.price,
    status = 'active',
    updated_at = now();

  RETURN json_build_object('success', true);
END;
$$;
