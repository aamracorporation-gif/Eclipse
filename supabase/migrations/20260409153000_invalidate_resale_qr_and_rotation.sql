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
  BEGIN
    v_scanner_id := p_scanned_by_text::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('valid', false, 'message', 'ID de escáner inválido');
  END;

  SELECT * INTO v_ticket FROM public.tickets
  WHERE qr_token::text = p_qr_token
     OR qr_code = p_qr_token
  LIMIT 1;

  IF v_ticket IS NULL THEN
    PERFORM public.notify(v_scanner_id, 'staff', 'invalid_ticket', '🚫 Ticket inválido detectado. El código no existe.');
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
    PERFORM public.notify(v_scanner_id, 'staff', 'wrong_event', '⚠️ Ticket detectado para otro evento o cuenta.');
    RETURN jsonb_build_object(
      'valid', false,
      'message', 'Esta entrada no pertenece a tus eventos',
      'ticket', v_ticket_info
    );
  END IF;

  IF v_ticket.ticket_status = 'reselling' OR v_ticket.status = 'resale' THEN
    PERFORM public.notify(v_scanner_id, 'staff', 'resale_ticket', '⛔ Intento de acceso con una entrada en reventa.');
    PERFORM public.notify(v_ticket.user_id, 'attendee', 'validation_failed', '🚫 Este QR no es válido porque la entrada está en reventa.');
    RETURN jsonb_build_object(
      'valid', false,
      'message', 'ENTRADA EN REVENTA - NO VÁLIDA',
      'ticket', v_ticket_info
    );
  END IF;

  IF v_ticket.ticket_status IS DISTINCT FROM 'active' OR v_ticket.status IS DISTINCT FROM 'valid' THEN
    PERFORM public.notify(v_scanner_id, 'staff', 'invalid_state', '⛔ Intento de acceso con una entrada en estado inválido.');
    RETURN jsonb_build_object(
      'valid', false,
      'message', 'ENTRADA NO VÁLIDA',
      'ticket', v_ticket_info
    );
  END IF;

  IF v_ticket.scanned_at IS NOT NULL THEN
    PERFORM public.notify(v_ticket.user_id, 'attendee', 'validation_failed', '🚫 Este QR ya fue usado o no es válido. Consulta con el staff para ayudarte.');
    PERFORM public.notify(v_scanner_id, 'staff', 'duplicate_qr', '🚩 ALERTA: Intento de uso duplicado del mismo QR.');
    PERFORM public.notify(v_event.creator_id, 'organizer', 'security_alert', '🚩 Seguridad: Se ha detectado un intento de entrada duplicada.');

    RETURN jsonb_build_object(
      'valid', false,
      'message', 'ESTA ENTRADA YA FUE ESCANEADA',
      'ticket', v_ticket_info
    );
  END IF;

  UPDATE public.tickets
  SET scanned_at = now(),
      validation_status = 'used',
      ticket_status = 'used',
      status = 'used'
  WHERE id = v_ticket.id;

  PERFORM public.notify(v_ticket.user_id, 'attendee', 'entry_success', '✅ Dentro. Que empiece la experiencia.');

  RETURN jsonb_build_object(
    'valid', true,
    'message', 'ACCESO AUTORIZADO',
    'ticket', jsonb_build_object(
      'id', v_ticket.id,
      'event', v_event.title,
      'owner', v_user.full_name,
      'date', v_event.event_date,
      'scanned_at', now()
    )
  );
END;
$$;

NOTIFY pgrst, 'reload schema';

