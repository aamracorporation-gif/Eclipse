-- ============================================================
-- validate_ticket_qr_v3
-- Organizer/admin ticket scanner. Always returns JSONB, never
-- throws exceptions for business-logic failures (wrong event,
-- already used, etc.) — only returns { valid, message, ticket }.
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_ticket_qr_v3(
  p_qr_token      text,
  p_scanned_by_text text,
  p_event_id      uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket          record;
  v_event           record;
  v_ticket_event_title text;
  v_owner_name      text;
  v_ticket_type_name text;
  v_scanner_id      uuid;
  v_is_admin        boolean := false;
  v_now             timestamptz := now();
  v_event_date_text text := '';
BEGIN
  -- Parse scanner UUID safely
  BEGIN
    v_scanner_id := p_scanned_by_text::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'valid', false,
      'message', 'Sesión inválida. Vuelve a iniciar sesión.'
    );
  END;

  -- Admin bypass (reads JWT claims; safe inside SECURITY DEFINER)
  BEGIN
    v_is_admin := (
      current_setting('request.jwt.claims', true)::jsonb ->> 'email'
    ) = 'aamracorporation@gmail.com';
  EXCEPTION WHEN OTHERS THEN
    v_is_admin := false;
  END;

  -- Fetch the selected event
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id LIMIT 1;

  IF v_event IS NULL THEN
    RETURN jsonb_build_object(
      'valid', false,
      'message', 'Evento no encontrado. Selecciona la fiesta correcta.'
    );
  END IF;

  -- Only the event creator (or admin) may validate tickets
  IF NOT v_is_admin AND v_event.creator_id IS DISTINCT FROM v_scanner_id THEN
    RETURN jsonb_build_object(
      'valid', false,
      'message', 'No tienes permiso para validar entradas de este evento.'
    );
  END IF;

  -- Read event date safely (column name may vary across schema versions)
  BEGIN
    v_event_date_text := v_event.event_date::text;
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      v_event_date_text := v_event.date::text;
    EXCEPTION WHEN OTHERS THEN
      v_event_date_text := '';
    END;
  END;

  -- Find the ticket
  SELECT * INTO v_ticket
  FROM public.tickets
  WHERE qr_token::text = p_qr_token
     OR qr_code       = p_qr_token
     OR id::text      = p_qr_token
  LIMIT 1;

  IF v_ticket IS NULL THEN
    RETURN jsonb_build_object(
      'valid', false,
      'message', 'Entrada no encontrada. QR no reconocido.'
    );
  END IF;

  -- Ticket must belong to the selected event
  IF v_ticket.event_id IS DISTINCT FROM p_event_id THEN
    BEGIN
      SELECT title INTO v_ticket_event_title
      FROM public.events WHERE id = v_ticket.event_id LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
      v_ticket_event_title := 'otro evento';
    END;
    RETURN jsonb_build_object(
      'valid', false,
      'message', 'Esta entrada pertenece a otro evento.',
      'ticket', jsonb_build_object(
        'event', COALESCE(v_ticket_event_title, 'Otro evento'),
        'owner', '',
        'date', ''
      )
    );
  END IF;

  -- Get owner display name (SECURITY DEFINER bypasses RLS — safe)
  BEGIN
    SELECT full_name INTO v_owner_name
    FROM public.profiles WHERE id = v_ticket.user_id LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_owner_name := NULL;
  END;

  v_owner_name := COALESCE(
    NULLIF(v_ticket.attendee_name, ''),
    NULLIF(v_ticket.buyer_name, ''),
    v_owner_name,
    'Desconocido'
  );

  -- Reselling check
  IF v_ticket.ticket_status = 'reselling' OR v_ticket.status = 'resale' THEN
    RETURN jsonb_build_object(
      'valid', false,
      'message', 'Entrada en reventa — acceso denegado.',
      'ticket', jsonb_build_object(
        'event', v_event.title,
        'owner', v_owner_name,
        'date',  v_event_date_text
      )
    );
  END IF;

  -- Invalidated check
  IF v_ticket.ticket_status = 'invalidated' OR v_ticket.status = 'cancelled' THEN
    RETURN jsonb_build_object(
      'valid', false,
      'message', 'Esta entrada ha sido invalidada.',
      'ticket', jsonb_build_object(
        'event', v_event.title,
        'owner', v_owner_name,
        'date',  v_event_date_text
      )
    );
  END IF;

  -- Already used check
  IF v_ticket.scanned_at IS NOT NULL
     OR v_ticket.validation_status = 'used'
     OR v_ticket.status            = 'used'
     OR v_ticket.ticket_status     = 'used'
  THEN
    RETURN jsonb_build_object(
      'valid', false,
      'message', 'Esta entrada ya fue escaneada.',
      'ticket', jsonb_build_object(
        'event',      v_event.title,
        'owner',      v_owner_name,
        'date',       v_event_date_text,
        'scanned_at', COALESCE(v_ticket.scanned_at::text, '')
      )
    );
  END IF;

  -- Ticket type label
  v_ticket_type_name := NULL;
  BEGIN
    IF v_ticket.ticket_type_id IS NOT NULL THEN
      SELECT name INTO v_ticket_type_name
      FROM public.event_ticket_types
      WHERE id = v_ticket.ticket_type_id LIMIT 1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_ticket_type_name := NULL;
  END;
  v_ticket_type_name := COALESCE(
    v_ticket_type_name,
    NULLIF(v_ticket.ticket_type, ''),
    'General'
  );

  -- Mark as used
  BEGIN
    UPDATE public.tickets
    SET scanned_at        = v_now,
        validation_status = 'used',
        ticket_status     = 'used',
        status            = 'used'
    WHERE id = v_ticket.id;
  EXCEPTION WHEN undefined_column THEN
    -- Fallback if validation_status column missing
    UPDATE public.tickets
    SET scanned_at    = v_now,
        ticket_status = 'used',
        status        = 'used'
    WHERE id = v_ticket.id;
  END;

  RETURN jsonb_build_object(
    'valid',       true,
    'message',     'Acceso autorizado',
    'ticket_type', v_ticket_type_name,
    'ticket', jsonb_build_object(
      'event',      v_event.title,
      'owner',      v_owner_name,
      'date',       v_event_date_text,
      'scanned_at', v_now::text
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_ticket_qr_v3(text, text, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
