-- Security release: bind scanners to auth.uid() and serialize ticket consumption.

CREATE OR REPLACE FUNCTION public.validate_ticket_qr_v3(p_qr_token text, p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_ticket public.tickets%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_owner_name text;
  v_ticket_type_name text;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_event_id IS NULL OR nullif(btrim(p_qr_token), '') IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'message', 'Solicitud inválida');
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('valid', false, 'message', 'Evento no encontrado'); END IF;
  IF v_event.creator_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_ticket
  FROM public.tickets
  WHERE event_id = p_event_id
    AND (qr_token::text = p_qr_token OR qr_code = p_qr_token OR id::text = p_qr_token OR short_code = upper(p_qr_token))
  LIMIT 1 FOR UPDATE;

  IF NOT FOUND THEN RETURN jsonb_build_object('valid', false, 'message', 'Entrada no encontrada'); END IF;
  IF v_ticket.ticket_status = 'reselling' OR v_ticket.status = 'resale' THEN
    RETURN jsonb_build_object('valid', false, 'message', 'ENTRADA EN REVENTA - NO VÁLIDA', 'event_id', p_event_id);
  END IF;
  IF v_ticket.ticket_status = 'invalidated' OR v_ticket.status = 'cancelled' THEN
    RETURN jsonb_build_object('valid', false, 'message', 'ENTRADA INVALIDADA', 'event_id', p_event_id);
  END IF;
  IF v_ticket.scanned_at IS NOT NULL OR v_ticket.validation_status = 'used' OR v_ticket.status = 'used' OR v_ticket.ticket_status = 'used' THEN
    RETURN jsonb_build_object('valid', false, 'message', 'ESTA ENTRADA YA FUE ESCANEADA', 'event_id', p_event_id, 'scanned_at', v_ticket.scanned_at);
  END IF;

  SELECT full_name INTO v_owner_name FROM public.profiles WHERE id = v_ticket.user_id;
  SELECT name INTO v_ticket_type_name FROM public.event_ticket_types WHERE id = v_ticket.ticket_type_id;
  UPDATE public.tickets SET scanned_at=v_now, validation_status='used', ticket_status='used', status='used' WHERE id=v_ticket.id;
  RETURN jsonb_build_object('valid', true, 'message', 'ACCESO AUTORIZADO', 'event_id', p_event_id,
    'attendee_name', coalesce(nullif(v_ticket.attendee_name,''), nullif(v_ticket.buyer_name,''), v_owner_name, 'Desconocido'),
    'ticket_type', coalesce(v_ticket_type_name, nullif(v_ticket.ticket_type,''), 'General'), 'scanned_at', v_now);
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_ticket_worker_v2(p_qr_token text, p_worker_id uuid, p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_worker public.workers%ROWTYPE;
  v_ticket public.tickets%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_owner_name text;
  v_ticket_type_name text;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_worker FROM public.workers
   WHERE id=p_worker_id
     AND user_id=auth.uid()
     AND status='active'
     AND (
       permissions ? 'scan'
       OR lower(coalesce(permissions->>'scan', 'false')) = 'true'
     );
  IF NOT FOUND THEN RAISE EXCEPTION 'Worker not found, inactive, or scan permission denied' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.worker_event_assignments WHERE worker_id=v_worker.id AND event_id=p_event_id AND status='active') THEN
    RAISE EXCEPTION 'Worker is not assigned to this event' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id AND creator_id=v_worker.organizer_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('valid', false, 'message', 'ENTRADA DE OTRO ORGANIZADOR'); END IF;

  SELECT * INTO v_ticket FROM public.tickets
   WHERE event_id=p_event_id AND (qr_token::text=p_qr_token OR qr_code=p_qr_token OR id::text=p_qr_token OR short_code=upper(p_qr_token))
   LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('valid', false, 'message', 'Entrada no encontrada'); END IF;
  IF v_ticket.ticket_status='reselling' OR v_ticket.status='resale' THEN RETURN jsonb_build_object('valid',false,'message','ENTRADA EN REVENTA - NO VÁLIDA','event_id',p_event_id); END IF;
  IF v_ticket.ticket_status='invalidated' OR v_ticket.status='cancelled' THEN RETURN jsonb_build_object('valid',false,'message','ENTRADA INVALIDADA','event_id',p_event_id); END IF;
  IF v_ticket.scanned_at IS NOT NULL OR v_ticket.validation_status='used' OR v_ticket.status='used' OR v_ticket.ticket_status='used' THEN
    RETURN jsonb_build_object('valid',false,'message','ESTA ENTRADA YA FUE ESCANEADA','event_id',p_event_id,'scanned_at',v_ticket.scanned_at);
  END IF;
  SELECT full_name INTO v_owner_name FROM public.profiles WHERE id=v_ticket.user_id;
  SELECT name INTO v_ticket_type_name FROM public.event_ticket_types WHERE id=v_ticket.ticket_type_id;
  UPDATE public.tickets SET scanned_at=v_now, validation_status='used', ticket_status='used', status='used', scanned_by_worker_id=v_worker.id WHERE id=v_ticket.id;
  RETURN jsonb_build_object('valid',true,'message','ACCESO AUTORIZADO','event_id',p_event_id,
    'attendee_name',coalesce(nullif(v_ticket.attendee_name,''),nullif(v_ticket.buyer_name,''),v_owner_name,'Desconocido'),
    'ticket_type',coalesce(v_ticket_type_name,nullif(v_ticket.ticket_type,''),'General'),'scanned_at',v_now);
END;
$$;

REVOKE ALL ON FUNCTION public.validate_ticket_qr_v3(text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.validate_ticket_worker_v2(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_ticket_qr_v3(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_ticket_worker_v2(text, uuid, uuid) TO authenticated;
