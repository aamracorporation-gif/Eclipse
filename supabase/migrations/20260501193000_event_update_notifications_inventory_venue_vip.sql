CREATE OR REPLACE FUNCTION public.send_event_update_notifications(
  p_event_id uuid,
  p_old jsonb,
  p_new jsonb,
  p_force boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  r record;
  v_changed text[];
  v_key text;
  v_relevant text[];
  v_ignored text[] := ARRAY[
    'sold_tickets',
    'updated_at',
    'created_at'
  ];
  v_time_changed boolean := false;
  v_location_changed boolean := false;
  v_policy_changed boolean := false;
  v_capacity_changed boolean := false;
  v_lineup_changed boolean := false;
  v_cancelled boolean := false;
  v_old_venue public.venues%ROWTYPE;
  v_new_venue public.venues%ROWTYPE;
  v_diff jsonb := '[]'::jsonb;
  v_data_base jsonb;
  v_data jsonb;
  v_last_notified timestamptz;
  v_updated_at timestamptz;
  v_available_changed boolean := false;
  v_sold_changed boolean := false;
BEGIN
  IF p_event_id IS NULL THEN
    RETURN;
  END IF;

  v_changed := ARRAY[]::text[];
  FOR v_key IN SELECT key FROM jsonb_each(p_new) LOOP
    IF (p_old->v_key) IS DISTINCT FROM (p_new->v_key) THEN
      v_changed := array_append(v_changed, v_key);
    END IF;
  END LOOP;

  v_available_changed := (p_old->'available_tickets') IS DISTINCT FROM (p_new->'available_tickets');
  v_sold_changed := (p_old->'sold_tickets') IS DISTINCT FROM (p_new->'sold_tickets');

  v_relevant := ARRAY(
    SELECT c FROM unnest(v_changed) AS c
    WHERE NOT (c = ANY(v_ignored))
  );

  IF COALESCE(array_length(v_relevant, 1), 0) = 0 AND NOT p_force THEN
    RETURN;
  END IF;

  IF v_available_changed AND v_sold_changed AND NOT p_force THEN
    IF COALESCE(array_length(v_relevant, 1), 0) = 1 AND v_relevant[1] = 'available_tickets' THEN
      RETURN;
    END IF;
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
    OR ('available_tickets' = ANY(v_relevant))
  );
  v_lineup_changed := (
    ('lineup' = ANY(v_relevant))
    OR ('artist' = ANY(v_relevant))
    OR ('artists' = ANY(v_relevant))
    OR ('speaker' = ANY(v_relevant))
    OR ('speakers' = ANY(v_relevant))
  );
  v_cancelled := (
    (NULLIF(COALESCE(p_new->>'status', ''), '') ILIKE 'cancel%')
    OR (COALESCE((p_new->>'is_cancelled')::boolean, false) = true AND COALESCE((p_old->>'is_cancelled')::boolean, false) = false)
    OR (NULLIF(COALESCE(p_new->>'cancelled_at', ''), '') IS NOT NULL AND NULLIF(COALESCE(p_old->>'cancelled_at', ''), '') IS NULL)
  );

  BEGIN
    v_updated_at := NULLIF(COALESCE(p_new->>'updated_at', ''), '')::timestamptz;
  EXCEPTION WHEN others THEN
    v_updated_at := now();
  END;
  IF v_updated_at IS NULL THEN
    v_updated_at := now();
  END IF;

  IF NULLIF(COALESCE(p_old->>'venue_id', ''), '') IS NOT NULL THEN
    BEGIN
      SELECT * INTO v_old_venue FROM public.venues v WHERE v.id = (p_old->>'venue_id')::uuid;
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END IF;
  IF NULLIF(COALESCE(p_new->>'venue_id', ''), '') IS NOT NULL THEN
    BEGIN
      SELECT * INTO v_new_venue FROM public.venues v WHERE v.id = (p_new->>'venue_id')::uuid;
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END IF;

  v_diff := COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'field', f,
        'old', COALESCE(p_old->>f, ''),
        'new', COALESCE(p_new->>f, '')
      )
    )
    FROM unnest(v_relevant) AS f
  ), '[]'::jsonb);

  v_data_base := jsonb_build_object(
    'event_id', p_event_id::text,
    'event_title', COALESCE(p_new->>'title', ''),
    'event_url', '/event/' || p_event_id::text,
    'changed_fields', COALESCE(to_jsonb(v_relevant), '[]'::jsonb),
    'diff', v_diff,
    'old_event_date', COALESCE(p_old->>'event_date', ''),
    'new_event_date', COALESCE(p_new->>'event_date', ''),
    'old_venue_id', COALESCE(p_old->>'venue_id', ''),
    'new_venue_id', COALESCE(p_new->>'venue_id', ''),
    'old_venue_name', COALESCE(v_old_venue.name, ''),
    'old_venue_address', COALESCE(v_old_venue.address, ''),
    'old_venue_latitude', COALESCE(v_old_venue.latitude::text, ''),
    'old_venue_longitude', COALESCE(v_old_venue.longitude::text, ''),
    'new_venue_name', COALESCE(v_new_venue.name, ''),
    'new_venue_address', COALESCE(v_new_venue.address, ''),
    'new_venue_latitude', COALESCE(v_new_venue.latitude::text, ''),
    'new_venue_longitude', COALESCE(v_new_venue.longitude::text, ''),
    'requires_confirmation', (v_time_changed OR v_location_changed OR v_policy_changed OR v_lineup_changed),
    'event_updated_at', v_updated_at::text
  );

  FOR r IN
    SELECT DISTINCT t.user_id
    FROM public.tickets t
    WHERE t.event_id = p_event_id
      AND t.user_id IS NOT NULL
      AND t.status = 'valid'
  LOOP
    IF NOT p_force THEN
      SELECT max(t.event_update_notified_at) INTO v_last_notified
      FROM public.tickets t
      WHERE t.event_id = p_event_id
        AND t.user_id = r.user_id
        AND t.status = 'valid';

      IF v_last_notified IS NOT NULL AND v_last_notified >= v_updated_at THEN
        CONTINUE;
      END IF;
    END IF;

    v_data := v_data_base;

    IF v_cancelled THEN
      BEGIN
        PERFORM public.enqueue_notification_from_template(r.user_id, 'attendee', 'event_cancelled', v_data);
      EXCEPTION WHEN others THEN
        NULL;
      END;
    ELSIF v_location_changed THEN
      BEGIN
        PERFORM public.enqueue_notification_from_template(r.user_id, 'attendee', 'event_location_changed', v_data);
      EXCEPTION WHEN others THEN
        NULL;
      END;
    ELSIF v_time_changed THEN
      BEGIN
        PERFORM public.enqueue_notification_from_template(r.user_id, 'attendee', 'event_time_changed', v_data);
      EXCEPTION WHEN others THEN
        NULL;
      END;
    ELSIF v_policy_changed THEN
      BEGIN
        PERFORM public.enqueue_notification_from_template(r.user_id, 'attendee', 'event_access_policy_changed', v_data);
      EXCEPTION WHEN others THEN
        NULL;
      END;
    ELSIF v_capacity_changed THEN
      BEGIN
        PERFORM public.enqueue_notification_from_template(r.user_id, 'attendee', 'event_capacity_or_price_changed', v_data);
      EXCEPTION WHEN others THEN
        NULL;
      END;
    ELSIF v_lineup_changed THEN
      BEGIN
        PERFORM public.enqueue_notification_from_template(r.user_id, 'attendee', 'event_lineup_changed', v_data);
      EXCEPTION WHEN others THEN
        NULL;
      END;
    ELSE
      BEGIN
        PERFORM public.enqueue_notification_from_template(r.user_id, 'attendee', 'event_updated', v_data);
      EXCEPTION WHEN others THEN
        NULL;
      END;
    END IF;

    UPDATE public.tickets
    SET event_update_notified_at = v_updated_at
    WHERE event_id = p_event_id
      AND user_id = r.user_id
      AND status = 'valid';
  END LOOP;
END;
$$;

UPDATE public.notification_templates
SET dedupe_seconds = 60, updated_at = now()
WHERE key IN ('event_capacity_or_price_changed', 'event_location_changed', 'event_time_changed')
  AND COALESCE(dedupe_seconds, 0) < 60;

CREATE OR REPLACE FUNCTION public.notify_event_venue_updated()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  e record;
  r record;
  v_data jsonb;
  v_updated_at timestamptz := date_trunc('second', now());
  v_last_notified timestamptz;
BEGIN
  IF (OLD.name IS NOT DISTINCT FROM NEW.name)
    AND (OLD.address IS NOT DISTINCT FROM NEW.address)
    AND (OLD.latitude IS NOT DISTINCT FROM NEW.latitude)
    AND (OLD.longitude IS NOT DISTINCT FROM NEW.longitude) THEN
    RETURN NEW;
  END IF;

  FOR e IN
    SELECT id, title
    FROM public.events
    WHERE venue_id = NEW.id
  LOOP
    v_data := jsonb_build_object(
      'event_id', e.id::text,
      'event_title', COALESCE(e.title, ''),
      'event_url', '/event/' || e.id::text,
      'changed_fields', jsonb_build_array('venue'),
      'diff', jsonb_build_array(
        jsonb_build_object(
          'field', 'venue',
          'old', jsonb_build_object('name', COALESCE(OLD.name, ''), 'address', COALESCE(OLD.address, ''), 'latitude', COALESCE(OLD.latitude::text, ''), 'longitude', COALESCE(OLD.longitude::text, '')),
          'new', jsonb_build_object('name', COALESCE(NEW.name, ''), 'address', COALESCE(NEW.address, ''), 'latitude', COALESCE(NEW.latitude::text, ''), 'longitude', COALESCE(NEW.longitude::text, ''))
        )
      ),
      'old_venue_name', COALESCE(OLD.name, ''),
      'old_venue_address', COALESCE(OLD.address, ''),
      'old_venue_latitude', COALESCE(OLD.latitude::text, ''),
      'old_venue_longitude', COALESCE(OLD.longitude::text, ''),
      'new_venue_name', COALESCE(NEW.name, ''),
      'new_venue_address', COALESCE(NEW.address, ''),
      'new_venue_latitude', COALESCE(NEW.latitude::text, ''),
      'new_venue_longitude', COALESCE(NEW.longitude::text, ''),
      'requires_confirmation', true,
      'event_updated_at', v_updated_at::text
    );

    FOR r IN
      SELECT DISTINCT t.user_id
      FROM public.tickets t
      WHERE t.event_id = e.id
        AND t.user_id IS NOT NULL
        AND t.status = 'valid'
    LOOP
      SELECT max(t.event_update_notified_at) INTO v_last_notified
      FROM public.tickets t
      WHERE t.event_id = e.id
        AND t.user_id = r.user_id
        AND t.status = 'valid';

      IF v_last_notified IS NOT NULL AND v_last_notified > v_updated_at - interval '60 seconds' THEN
        CONTINUE;
      END IF;

      BEGIN
        PERFORM public.enqueue_notification_from_template(r.user_id, 'attendee', 'event_location_changed', v_data);
      EXCEPTION WHEN others THEN
        NULL;
      END;

      UPDATE public.tickets
      SET event_update_notified_at = v_updated_at
      WHERE event_id = e.id
        AND user_id = r.user_id
        AND status = 'valid';
    END LOOP;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_venue_update_notify_event_buyers ON public.venues;
CREATE TRIGGER trg_venue_update_notify_event_buyers
AFTER UPDATE OF name, address, latitude, longitude ON public.venues
FOR EACH ROW
EXECUTE FUNCTION public.notify_event_venue_updated();

CREATE OR REPLACE FUNCTION public.notify_event_vip_catalog_updated()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event_id uuid;
  v_event_title text;
  r record;
  v_updated_at timestamptz := date_trunc('second', now());
  v_last_notified timestamptz;
  v_data jsonb;
  v_is_sale boolean := false;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_event_id := OLD.event_id;
    v_is_sale := false;
  ELSE
    v_event_id := NEW.event_id;
  END IF;

  IF v_event_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_is_sale := (NEW.quantity_available IS NOT NULL AND OLD.quantity_available IS NOT NULL AND NEW.quantity_available < OLD.quantity_available)
      AND (OLD.name IS NOT DISTINCT FROM NEW.name)
      AND (OLD.description IS NOT DISTINCT FROM NEW.description)
      AND (OLD.base_price IS NOT DISTINCT FROM NEW.base_price)
      AND (OLD.capacity_people IS NOT DISTINCT FROM NEW.capacity_people)
      AND (OLD.included_bottles IS NOT DISTINCT FROM NEW.included_bottles)
      AND (OLD.extra_bottle_price IS NOT DISTINCT FROM NEW.extra_bottle_price);
    IF v_is_sale THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT e.title INTO v_event_title
  FROM public.events e
  WHERE e.id = v_event_id;

  v_data := jsonb_build_object(
    'event_id', v_event_id::text,
    'event_title', COALESCE(v_event_title, ''),
    'event_url', '/event/' || v_event_id::text,
    'changed_fields', jsonb_build_array('vip'),
    'requires_confirmation', false,
    'event_updated_at', v_updated_at::text
  );

  FOR r IN
    SELECT DISTINCT t.user_id
    FROM public.tickets t
    WHERE t.event_id = v_event_id
      AND t.user_id IS NOT NULL
      AND t.status = 'valid'
  LOOP
    SELECT max(t.event_update_notified_at) INTO v_last_notified
    FROM public.tickets t
    WHERE t.event_id = v_event_id
      AND t.user_id = r.user_id
      AND t.status = 'valid';

    IF v_last_notified IS NOT NULL AND v_last_notified > v_updated_at - interval '60 seconds' THEN
      CONTINUE;
    END IF;

    BEGIN
      PERFORM public.enqueue_notification_from_template(r.user_id, 'attendee', 'event_capacity_or_price_changed', v_data);
    EXCEPTION WHEN others THEN
      NULL;
    END;

    UPDATE public.tickets
    SET event_update_notified_at = v_updated_at
    WHERE event_id = v_event_id
      AND user_id = r.user_id
      AND status = 'valid';
  END LOOP;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_vip_catalog_notify_buyers_ins ON public.reservados_vip;
CREATE TRIGGER trg_vip_catalog_notify_buyers_ins
AFTER INSERT ON public.reservados_vip
FOR EACH ROW
EXECUTE FUNCTION public.notify_event_vip_catalog_updated();

DROP TRIGGER IF EXISTS trg_vip_catalog_notify_buyers_upd ON public.reservados_vip;
CREATE TRIGGER trg_vip_catalog_notify_buyers_upd
AFTER UPDATE OF name, description, base_price, capacity_people, included_bottles, extra_bottle_price, quantity_available ON public.reservados_vip
FOR EACH ROW
EXECUTE FUNCTION public.notify_event_vip_catalog_updated();

DROP TRIGGER IF EXISTS trg_vip_catalog_notify_buyers_del ON public.reservados_vip;
CREATE TRIGGER trg_vip_catalog_notify_buyers_del
AFTER DELETE ON public.reservados_vip
FOR EACH ROW
EXECUTE FUNCTION public.notify_event_vip_catalog_updated();

NOTIFY pgrst, 'reload schema';
