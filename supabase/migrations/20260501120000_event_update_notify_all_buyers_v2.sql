CREATE OR REPLACE FUNCTION public.handle_event_updates_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  r record;
  v_old jsonb;
  v_new jsonb;
  v_changed text[];
  v_key text;
  v_ignored text[] := ARRAY[
    'available_tickets',
    'sold_tickets',
    'updated_at',
    'created_at'
  ];
  v_relevant text[];
  v_time_changed boolean := false;
  v_location_changed boolean := false;
  v_policy_changed boolean := false;
  v_capacity_changed boolean := false;
  v_lineup_changed boolean := false;
  v_cancelled boolean := false;
  v_old_venue public.venues%ROWTYPE;
  v_new_venue public.venues%ROWTYPE;
  v_data_base jsonb;
  v_data jsonb;
  v_lang text;
BEGIN
  v_old := to_jsonb(OLD);
  v_new := to_jsonb(NEW);
  v_changed := ARRAY[]::text[];

  FOR v_key IN SELECT key FROM jsonb_each(v_new) LOOP
    IF (v_old->v_key) IS DISTINCT FROM (v_new->v_key) THEN
      v_changed := array_append(v_changed, v_key);
    END IF;
  END LOOP;

  v_relevant := ARRAY(
    SELECT c FROM unnest(v_changed) AS c
    WHERE NOT (c = ANY(v_ignored))
  );

  IF COALESCE(array_length(v_relevant, 1), 0) = 0 THEN
    RETURN NEW;
  END IF;

  v_time_changed := ('event_date' = ANY(v_relevant));
  v_location_changed := ('venue_id' = ANY(v_relevant));

  v_policy_changed := (
    ('age_restriction' = ANY(v_relevant))
    OR ('dress_code' = ANY(v_relevant))
    OR ('access_policy' = ANY(v_relevant))
    OR ('access_requirements' = ANY(v_relevant))
  );

  v_capacity_changed := (
    ('capacity' = ANY(v_relevant))
    OR ('max_capacity' = ANY(v_relevant))
    OR ('ticket_price' = ANY(v_relevant))
  );

  v_lineup_changed := (
    ('lineup' = ANY(v_relevant))
    OR ('artist' = ANY(v_relevant))
    OR ('artists' = ANY(v_relevant))
    OR ('speaker' = ANY(v_relevant))
    OR ('speakers' = ANY(v_relevant))
  );

  v_cancelled := (
    (NULLIF(COALESCE(v_new->>'status', ''), '') ILIKE 'cancel%')
    OR (COALESCE((v_new->>'is_cancelled')::boolean, false) = true AND COALESCE((v_old->>'is_cancelled')::boolean, false) = false)
    OR (NULLIF(COALESCE(v_new->>'cancelled_at', ''), '') IS NOT NULL AND NULLIF(COALESCE(v_old->>'cancelled_at', ''), '') IS NULL)
  );

  IF OLD.venue_id IS NOT NULL THEN
    BEGIN
      SELECT * INTO v_old_venue FROM public.venues v WHERE v.id = OLD.venue_id;
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END IF;

  IF NEW.venue_id IS NOT NULL THEN
    BEGIN
      SELECT * INTO v_new_venue FROM public.venues v WHERE v.id = NEW.venue_id;
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END IF;

  v_data_base := jsonb_build_object(
    'event_id', NEW.id::text,
    'event_title', COALESCE(NEW.title, ''),
    'changed_fields', COALESCE(to_jsonb(v_relevant), '[]'::jsonb),
    'old_event_date', COALESCE(OLD.event_date::text, ''),
    'new_event_date', COALESCE(NEW.event_date::text, ''),
    'old_venue_id', COALESCE(OLD.venue_id::text, ''),
    'new_venue_id', COALESCE(NEW.venue_id::text, ''),
    'old_venue_name', COALESCE(v_old_venue.name, ''),
    'old_venue_address', COALESCE(v_old_venue.address, ''),
    'old_venue_latitude', COALESCE(v_old_venue.latitude::text, ''),
    'old_venue_longitude', COALESCE(v_old_venue.longitude::text, ''),
    'new_venue_name', COALESCE(v_new_venue.name, ''),
    'new_venue_address', COALESCE(v_new_venue.address, ''),
    'new_venue_latitude', COALESCE(v_new_venue.latitude::text, ''),
    'new_venue_longitude', COALESCE(v_new_venue.longitude::text, ''),
    'requires_confirmation', (v_time_changed OR v_location_changed OR v_policy_changed OR v_lineup_changed)
  );

  FOR r IN
    SELECT DISTINCT t.user_id
    FROM public.tickets t
    WHERE t.event_id = NEW.id
      AND t.user_id IS NOT NULL
      AND t.status = 'valid'
  LOOP
    v_lang := NULL;
    BEGIN
      SELECT COALESCE(NULLIF(p.language, ''), 'es') INTO v_lang
      FROM public.profiles p
      WHERE p.id = r.user_id;
    EXCEPTION WHEN others THEN
      v_lang := 'es';
    END;

    v_data := v_data_base || jsonb_build_object('language', COALESCE(v_lang, 'es'));

    IF v_cancelled THEN
      BEGIN
        PERFORM public.enqueue_notification_from_template(r.user_id, 'attendee', 'event_cancelled', v_data);
      EXCEPTION WHEN others THEN
        NULL;
      END;
      CONTINUE;
    END IF;

    IF v_location_changed THEN
      BEGIN
        PERFORM public.enqueue_notification_from_template(r.user_id, 'attendee', 'event_location_changed', v_data);
      EXCEPTION WHEN others THEN
        NULL;
      END;
    END IF;

    IF v_time_changed THEN
      BEGIN
        PERFORM public.enqueue_notification_from_template(r.user_id, 'attendee', 'event_time_changed', v_data);
      EXCEPTION WHEN others THEN
        NULL;
      END;
    END IF;

    IF v_policy_changed THEN
      BEGIN
        PERFORM public.enqueue_notification_from_template(r.user_id, 'attendee', 'event_access_policy_changed', v_data);
      EXCEPTION WHEN others THEN
        NULL;
      END;
    END IF;

    IF v_capacity_changed THEN
      BEGIN
        PERFORM public.enqueue_notification_from_template(r.user_id, 'attendee', 'event_capacity_or_price_changed', v_data);
      EXCEPTION WHEN others THEN
        NULL;
      END;
    END IF;

    IF v_lineup_changed THEN
      BEGIN
        PERFORM public.enqueue_notification_from_template(r.user_id, 'attendee', 'event_lineup_changed', v_data);
      EXCEPTION WHEN others THEN
        NULL;
      END;
    END IF;

    IF NOT v_time_changed AND NOT v_location_changed AND NOT v_policy_changed AND NOT v_capacity_changed AND NOT v_lineup_changed THEN
      BEGIN
        PERFORM public.enqueue_notification_from_template(r.user_id, 'attendee', 'event_updated', v_data);
      EXCEPTION WHEN others THEN
        NULL;
      END;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_event_update ON public.events;
CREATE TRIGGER on_event_update
AFTER UPDATE ON public.events
FOR EACH ROW
EXECUTE FUNCTION public.handle_event_updates_notification();

INSERT INTO public.notification_templates (key, title_template, body_template, default_priority, default_channels, dedupe_seconds, enabled)
VALUES
  ('event_updated', '🔁 Cambios en el evento', 'Hubo cambios en "{{event_title}}". Revisa los nuevos detalles antes de ir.', 'high', ARRAY['in_app','push','email','sms']::text[], 60, true),
  ('event_time_changed', '⏰ Cambio de fecha u hora', '"{{event_title}}" cambió de fecha/hora. Revisa y confirma tu asistencia.', 'high', ARRAY['in_app','push','email','sms']::text[], 0, true),
  ('event_location_changed', '📍 Cambio de ubicación', '"{{event_title}}" cambió de ubicación. Abre el mapa para llegar sin problemas.', 'high', ARRAY['in_app','push','email','sms']::text[], 0, true),
  ('event_access_policy_changed', '🪪 Requisitos actualizados', '"{{event_title}}" actualizó requisitos/políticas de acceso. Revísalos antes de ir.', 'high', ARRAY['in_app','push','email']::text[], 0, true),
  ('event_capacity_or_price_changed', '🎟️ Cambios en entradas', '"{{event_title}}" cambió condiciones de aforo/precio. Revisa los detalles.', 'high', ARRAY['in_app','push','email']::text[], 0, true),
  ('event_lineup_changed', '🎤 Cambios de artista/ponente', '"{{event_title}}" actualizó artistas/ponentes. Revisa la info y opciones.', 'high', ARRAY['in_app','push','email']::text[], 0, true)
ON CONFLICT (key) DO UPDATE
SET
  title_template = EXCLUDED.title_template,
  body_template = EXCLUDED.body_template,
  default_priority = EXCLUDED.default_priority,
  default_channels = EXCLUDED.default_channels,
  dedupe_seconds = EXCLUDED.dedupe_seconds,
  enabled = EXCLUDED.enabled,
  updated_at = now();

NOTIFY pgrst, 'reload schema';
