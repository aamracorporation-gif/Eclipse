-- ==============================================================================
-- FIX SCANNER ISSUES (RLS & TYPES)
-- ==============================================================================

-- 1. Create robust validation function that bypasses RLS and handles Text/UUID types
CREATE OR REPLACE FUNCTION public.validate_ticket_qr_v2(p_qr_token text, p_scanned_by_text text)
RETURNS jsonb AS $$
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
  IF v_event.creator_id != v_scanner_id THEN
    RETURN jsonb_build_object(
      'valid', false,
      'message', 'Esta entrada no pertenece a tus eventos',
      'ticket', v_ticket_info
    );
  END IF;

  -- 2. Check if already scanned
  IF v_ticket.scanned_at IS NOT NULL OR v_ticket.status = 'used' THEN
    RETURN jsonb_build_object(
      'valid', false, 
      'message', 'Entrada YA utilizada', 
      'ticket', v_ticket_info
    );
  END IF;

  -- 3. Mark as scanned
  UPDATE public.tickets SET scanned_at = NOW(), status = 'used' WHERE id = v_ticket.id;
  
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Grant permissions just in case
GRANT EXECUTE ON FUNCTION public.validate_ticket_qr_v2 TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_ticket_qr_v2 TO service_role;

-- 4. Optional: event-scoped validator (requires selecting the event in the UI)
CREATE OR REPLACE FUNCTION public.validate_ticket_qr_v3(p_qr_token text, p_scanned_by_text text, p_event_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_ticket record;
  v_event record;
  v_user record;
  v_ticket_info jsonb;
  v_scanner_id uuid;
BEGIN
  BEGIN
    v_scanner_id := p_scanned_by_text::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('valid', false, 'message', 'ID de escáner inválido');
  END;

  IF p_event_id IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'message', 'Selecciona un evento antes de validar');
  END IF;

  SELECT * INTO v_ticket FROM public.tickets
  WHERE qr_token::text = p_qr_token
     OR id::text = p_qr_token
  LIMIT 1;

  IF v_ticket IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'message', 'Entrada no encontrada');
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = v_ticket.event_id;
  SELECT * INTO v_user FROM public.profiles WHERE id = v_ticket.user_id;

  v_ticket_info := jsonb_build_object(
    'id', v_ticket.id,
    'event', v_event.title,
    'owner', v_user.full_name,
    'date', v_event.event_date,
    'scanned_at', v_ticket.scanned_at
  );

  IF v_event.creator_id != v_scanner_id THEN
    RETURN jsonb_build_object('valid', false, 'message', 'Esta entrada no pertenece a tus eventos', 'ticket', v_ticket_info);
  END IF;

  IF v_ticket.event_id IS DISTINCT FROM p_event_id THEN
    RETURN jsonb_build_object('valid', false, 'message', 'Esta entrada no pertenece al evento seleccionado', 'ticket', v_ticket_info);
  END IF;

  IF v_ticket.scanned_at IS NOT NULL OR v_ticket.status = 'used' THEN
    RETURN jsonb_build_object('valid', false, 'message', 'Entrada YA utilizada', 'ticket', v_ticket_info);
  END IF;

  UPDATE public.tickets SET scanned_at = NOW(), status = 'used' WHERE id = v_ticket.id;

  RETURN jsonb_build_object(
    'valid', true,
    'message', 'ACCESO AUTORIZADO',
    'ticket', jsonb_build_object(
      'id', v_ticket.id,
      'event', v_event.title,
      'owner', v_user.full_name,
      'date', v_event.event_date,
      'scanned_at', NOW()
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.validate_ticket_qr_v3 TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_ticket_qr_v3 TO service_role;

-- 3. Reload schema cache
NOTIFY pgrst, 'reload config';
