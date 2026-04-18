CREATE OR REPLACE FUNCTION public.validate_ticket_worker_v2(
  p_qr_token text,
  p_worker_id uuid,
  p_event_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_worker record;
  v_ticket record;
  v_event record;
  v_owner record;
  v_ticket_type_name text;
  v_now timestamptz := now();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT w.id, w.organizer_id
  INTO v_worker
  FROM public.workers w
  WHERE w.id = p_worker_id
    AND w.status = 'active'
  LIMIT 1;

  IF v_worker IS NULL THEN
    RAISE EXCEPTION 'Worker not found or inactive';
  END IF;

  SELECT *
  INTO v_ticket
  FROM public.tickets t
  WHERE t.qr_token::text = p_qr_token
     OR t.qr_code = p_qr_token
  LIMIT 1;

  IF v_ticket IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'message', 'Entrada no encontrada');
  END IF;

  SELECT *
  INTO v_event
  FROM public.events e
  WHERE e.id = v_ticket.event_id
  LIMIT 1;

  IF v_event IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'message', 'Evento no encontrado', 'event_id', v_ticket.event_id);
  END IF;

  IF v_event.creator_id IS DISTINCT FROM v_worker.organizer_id THEN
    RETURN jsonb_build_object(
      'valid', false,
      'message', 'ENTRADA DE OTRO ORGANIZADOR',
      'event_id', v_event.id
    );
  END IF;

  IF p_event_id IS NULL OR v_event.id IS DISTINCT FROM p_event_id THEN
    RETURN jsonb_build_object(
      'valid', false,
      'message', 'ENTRADA DE OTRO EVENTO',
      'event_id', v_event.id
    );
  END IF;

  IF v_ticket.ticket_status = 'reselling' OR v_ticket.status = 'resale' THEN
    RETURN jsonb_build_object(
      'valid', false,
      'message', 'ENTRADA EN REVENTA - NO VÁLIDA',
      'event_id', v_event.id
    );
  END IF;

  IF v_ticket.scanned_at IS NOT NULL OR v_ticket.validation_status = 'used' OR v_ticket.status = 'used' OR v_ticket.ticket_status = 'used' THEN
    RETURN jsonb_build_object(
      'valid', false,
      'message', 'ESTA ENTRADA YA FUE ESCANEADA',
      'event_id', v_event.id,
      'scanned_at', v_ticket.scanned_at,
      'ticket_type', COALESCE(NULLIF(v_ticket.ticket_type, ''), 'General'),
      'attendee_name', COALESCE(NULLIF(v_ticket.attendee_name, ''), NULLIF(v_ticket.buyer_name, ''), 'Desconocido')
    );
  END IF;

  SELECT full_name INTO v_owner
  FROM public.profiles p
  WHERE p.id = v_ticket.user_id
  LIMIT 1;

  v_ticket_type_name := NULL;
  BEGIN
    IF v_ticket.ticket_type_id IS NOT NULL THEN
      SELECT name INTO v_ticket_type_name
      FROM public.event_ticket_types
      WHERE id = v_ticket.ticket_type_id
      LIMIT 1;
    END IF;
  EXCEPTION WHEN undefined_column OR undefined_table THEN
    v_ticket_type_name := NULL;
  END;

  UPDATE public.tickets
  SET scanned_at = v_now,
      validation_status = 'used',
      ticket_status = 'used',
      status = 'used'
  WHERE id = v_ticket.id;

  RETURN jsonb_build_object(
    'valid', true,
    'message', 'ACCESO AUTORIZADO',
    'event_id', v_event.id,
    'attendee_name', COALESCE(NULLIF(v_ticket.attendee_name, ''), NULLIF(v_ticket.buyer_name, ''), v_owner.full_name, 'Desconocido'),
    'ticket_type', COALESCE(v_ticket_type_name, NULLIF(v_ticket.ticket_type, ''), 'General'),
    'scanned_at', v_now
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_ticket_worker_v2(text, uuid, uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';

