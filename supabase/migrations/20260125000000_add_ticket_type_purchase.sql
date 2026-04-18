
-- Add ticket_type_id to tickets table
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS ticket_type_id uuid REFERENCES event_ticket_types(id);

-- Update RPC to handle ticket types
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
BEGIN
  -- 1. Check event availability
  SELECT available_tickets INTO v_event_available
  FROM events
  WHERE id = p_event_id;

  IF v_event_available IS NULL THEN
    RAISE EXCEPTION 'Event not found';
  END IF;

  IF v_event_available < p_quantity THEN
    RAISE EXCEPTION 'Not enough tickets available in event';
  END IF;

  -- 2. Check ticket type availability (if specified)
  IF p_ticket_type_id IS NOT NULL THEN
    SELECT quantity - COALESCE(sold, 0) INTO v_ticket_type_available
    FROM event_ticket_types
    WHERE id = p_ticket_type_id;
    
    IF v_ticket_type_available IS NULL OR v_ticket_type_available < p_quantity THEN
        RAISE EXCEPTION 'Not enough tickets of this type available';
    END IF;
  END IF;

  -- 3. Insert ticket
  INSERT INTO tickets (
    event_id, 
    user_id, 
    buyer_name, 
    buyer_email, 
    quantity, 
    total_price, 
    qr_code,
    ticket_type_id
  )
  VALUES (
    p_event_id, 
    p_user_id, 
    p_buyer_name, 
    p_buyer_email, 
    p_quantity, 
    p_total_price, 
    p_qr_code,
    p_ticket_type_id
  )
  RETURNING id INTO v_ticket_id;

  -- 4. Update event stats
  UPDATE events
  SET 
    available_tickets = available_tickets - p_quantity,
    sold_tickets = COALESCE(sold_tickets, 0) + p_quantity
  WHERE id = p_event_id;

  -- 5. Update ticket type stats (if specified)
  IF p_ticket_type_id IS NOT NULL THEN
    UPDATE event_ticket_types
    SET sold = COALESCE(sold, 0) + p_quantity
    WHERE id = p_ticket_type_id;
  END IF;

  RETURN json_build_object('ticket_id', v_ticket_id);
END;
$$;
