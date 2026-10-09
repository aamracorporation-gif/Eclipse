-- Function to handle ticket purchase atomically and bypass RLS for event updates
CREATE OR REPLACE FUNCTION purchase_ticket(
  p_event_id uuid,
  p_user_id uuid,
  p_buyer_name text,
  p_buyer_email text,
  p_quantity integer,
  p_total_price numeric,
  p_qr_code text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER -- Runs with privileges of the function creator (postgres)
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event_available integer;
  v_ticket_id uuid;
BEGIN
  -- 1. Check availability
  SELECT available_tickets INTO v_event_available
  FROM events
  WHERE id = p_event_id;

  IF v_event_available IS NULL THEN
    RAISE EXCEPTION 'Event not found';
  END IF;

  IF v_event_available < p_quantity THEN
    RAISE EXCEPTION 'Not enough tickets available';
  END IF;

  -- 2. Insert ticket
  INSERT INTO tickets (
    event_id, 
    user_id, 
    buyer_name, 
    buyer_email, 
    quantity, 
    total_price, 
    qr_code
  )
  VALUES (
    p_event_id, 
    p_user_id, 
    p_buyer_name, 
    p_buyer_email, 
    p_quantity, 
    p_total_price, 
    p_qr_code
  )
  RETURNING id INTO v_ticket_id;

  -- 3. Update event stats (bypass RLS thanks to SECURITY DEFINER)
  UPDATE events
  SET 
    available_tickets = available_tickets - p_quantity,
    sold_tickets = COALESCE(sold_tickets, 0) + p_quantity
  WHERE id = p_event_id;

  -- Return the new ticket ID
  RETURN json_build_object('ticket_id', v_ticket_id);
END;
$$;

-- Legacy RPC retained only for migration compatibility. Purchases are fulfilled
-- by the signed Stripe webhook using the service role, never by a mobile client.
REVOKE ALL ON FUNCTION purchase_ticket(uuid, uuid, text, text, integer, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION purchase_ticket(uuid, uuid, text, text, integer, numeric, text) TO service_role;
