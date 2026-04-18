-- Migration: Enforce Ticket Security & Standardize Validation
-- Date: 2026-03-08

-- 1. Ensure 'scanned_at' and 'validation_status' columns exist and are indexed
CREATE INDEX IF NOT EXISTS idx_tickets_qr_token ON tickets(qr_token);
CREATE INDEX IF NOT EXISTS idx_tickets_scanned_at ON tickets(scanned_at);
CREATE INDEX IF NOT EXISTS idx_tickets_validation_status ON tickets(validation_status);

-- 2. Update the main validation function used by the Scanner App (validate_ticket_qr_v2)
-- This ensures that when an organizer scans a ticket, it is marked as used in ALL fields.
CREATE OR REPLACE FUNCTION public.validate_ticket_qr_v2(p_qr_token text, p_scanned_by_text text)
RETURNS jsonb 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ticket record;
  v_event record;
  v_user record;
  v_ticket_info jsonb;
  v_scanner_id uuid;
BEGIN
  -- Explicit cast to avoid "operator does not exist: uuid = text" errors
  BEGIN
    v_scanner_id := p_scanned_by_text::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('valid', false, 'message', 'ID de escáner inválido');
  END;

  -- Find ticket by token (Try UUID token first, then fallback to ID if needed)
  -- We cast columns to text to ensure comparison works regardless of column type
  SELECT * INTO v_ticket FROM public.tickets 
  WHERE qr_token::text = p_qr_token 
  OR id::text = p_qr_token 
  LIMIT 1;

  IF v_ticket IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'message', 'Entrada no encontrada');
  END IF;

  -- Get Event Info
  SELECT * INTO v_event FROM public.events WHERE id = v_ticket.event_id;
  
  -- Get User Info
  SELECT * INTO v_user FROM public.profiles WHERE id = v_ticket.user_id;

  -- Construct basic ticket info for display
  v_ticket_info := jsonb_build_object(
    'id', v_ticket.id,
    'event', v_event.title,
    'owner', v_user.full_name,
    'date', v_event.event_date,
    'scanned_at', v_ticket.scanned_at
  );

  -- 1. Check if the scanner is the organizer of the event
  -- (Logic can be expanded to allow workers if needed, but this function is for organizers)
  IF v_event.creator_id != v_scanner_id THEN
    RETURN jsonb_build_object(
      'valid', false,
      'message', 'Esta entrada no pertenece a tus eventos',
      'ticket', v_ticket_info
    );
  END IF;

  -- 2. Check if already scanned
  IF v_ticket.scanned_at IS NOT NULL OR v_ticket.status = 'used' OR v_ticket.validation_status = 'used' THEN
    RETURN jsonb_build_object(
      'valid', false, 
      'message', 'ENTRADA YA USADA', 
      'scanned_at', v_ticket.scanned_at,
      'ticket', v_ticket_info
    );
  END IF;

  -- 3. Mark as scanned (UPDATE ALL STATUS FIELDS)
  UPDATE public.tickets SET 
    scanned_at = NOW(), 
    status = 'used',
    validation_status = 'used'
  WHERE id = v_ticket.id;
  
  -- Return success
  RETURN jsonb_build_object(
    'valid', true,
    'message', 'Entrada Válida',
    'ticket', jsonb_build_object(
        'id', v_ticket.id,
        'event', v_event.title,
        'owner', v_user.full_name,
        'date', v_event.event_date,
        'scanned_at', NOW()
    )
  );
END;
$$;

-- 3. Trigger to prevent Resale of Used Tickets (Backend Enforcer)
-- Even if frontend hacks the button, the DB rejects the update to 'resale' status if scanned_at is set.

CREATE OR REPLACE FUNCTION prevent_resale_of_used_tickets()
RETURNS TRIGGER AS $$
BEGIN
  -- If trying to change status to 'resale'
  IF NEW.status = 'resale' THEN
    -- Check if it was already scanned or marked as used
    IF OLD.scanned_at IS NOT NULL OR OLD.validation_status = 'used' OR OLD.status = 'used' THEN
      RAISE EXCEPTION 'No se puede revender una entrada ya utilizada (Fraud Prevention)';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS check_resale_validity ON tickets;
CREATE TRIGGER check_resale_validity
  BEFORE UPDATE ON tickets
  FOR EACH ROW
  EXECUTE FUNCTION prevent_resale_of_used_tickets();

-- 4. Notify to reload schema cache
NOTIFY pgrst, 'reload config';
