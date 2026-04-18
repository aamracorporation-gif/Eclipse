-- Corregir función validate_ticket_worker eliminando la referencia a la columna inexistente 'metadata'

CREATE OR REPLACE FUNCTION validate_ticket_worker(
  p_qr_token text,
  p_worker_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ticket_id uuid;
  v_event_id uuid;
  v_status text;
  v_scanned_at timestamptz;
  v_attendee_name text;
  v_ticket_type text;
  v_worker_status text;
  v_worker_org_id uuid;
  v_event_org_id uuid;
BEGIN
  -- 1. Check if worker is active
  SELECT status, organizer_id INTO v_worker_status, v_worker_org_id
  FROM public.workers
  WHERE id = p_worker_id;

  IF v_worker_status IS NULL OR v_worker_status != 'active' THEN
    RETURN jsonb_build_object('valid', false, 'message', 'Trabajador no activo');
  END IF;

  -- 2. Find ticket
  -- Eliminada referencia a t.metadata
  SELECT 
    t.id, t.event_id, t.status, t.scanned_at, t.attendee_name, t.ticket_type,
    e.creator_id
  INTO 
    v_ticket_id, v_event_id, v_status, v_scanned_at, v_attendee_name, v_ticket_type,
    v_event_org_id
  FROM public.tickets t
  JOIN public.events e ON t.event_id = e.id
  WHERE t.qr_token = p_qr_token;

  IF v_ticket_id IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'message', 'Entrada no encontrada');
  END IF;

  -- 3. Check if worker belongs to the event organizer
  IF v_worker_org_id != v_event_org_id THEN
    RETURN jsonb_build_object('valid', false, 'message', 'No tienes permiso para este evento');
  END IF;

  -- 4. Check ticket status
  IF v_status = 'used' THEN
    RETURN jsonb_build_object(
      'valid', false, 
      'message', 'Entrada ya utilizada',
      'scanned_at', v_scanned_at
    );
  END IF;

  IF v_status = 'expired' THEN
    RETURN jsonb_build_object('valid', false, 'message', 'ENTRADA CADUCADA');
  END IF;

  IF v_status != 'valid' THEN
    RETURN jsonb_build_object('valid', false, 'message', 'Entrada no válida (' || v_status || ')');
  END IF;

  -- 5. Mark as used
  UPDATE public.tickets
  SET 
    status = 'used',
    scanned_at = now(),
    scanned_by_worker_id = p_worker_id
  WHERE id = v_ticket_id;

  RETURN jsonb_build_object(
    'valid', true,
    'ticket_id', v_ticket_id,
    'attendee_name', v_attendee_name,
    'ticket_type', v_ticket_type,
    'scanned_at', now()
  );
END;
$$;

-- Recargar caché de esquema por si acaso
NOTIFY pgrst, 'reload schema';
