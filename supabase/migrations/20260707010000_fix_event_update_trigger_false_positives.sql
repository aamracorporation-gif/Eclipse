-- Fix: event update notifier was firing on purchase because ticket-purchase RPCs
-- update counter fields on the events table (ticket_count, capacity_remaining, etc.)
-- that were NOT in the ignored list. Expand the ignored list to cover all auto-managed fields.

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
  -- All fields that change automatically (counters, timestamps) — NOT real event changes
  v_ignored text[] := ARRAY[
    'available_tickets',
    'sold_tickets',
    'ticket_count',
    'tickets_sold',
    'tickets_available',
    'tickets_remaining',
    'capacity_remaining',
    'available_capacity',
    'remaining_capacity',
    'sold_count',
    'purchase_count',
    'vip_sold',
    'vip_available',
    'vip_remaining',
    'table_sold',
    'table_available',
    'table_remaining',
    'revenue',
    'total_revenue',
    'gross_revenue',
    'net_revenue',
    'updated_at',
    'created_at',
    'last_sale_at',
    'last_purchase_at'
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

  v_relevant := ARRAY(
    SELECT c FROM unnest(v_changed) AS c
    WHERE NOT (c = ANY(v_ignored))
  );

  IF COALESCE(array_length(v_relevant, 1), 0) = 0 AND NOT p_force THEN
    RETURN;
  END IF;

  -- Only fire for fields that actually matter to attendees
  v_time_changed     := ('event_date' = ANY(v_relevant));
  v_location_changed := ('venue_id' = ANY(v_relevant));
  v_policy_changed   := (
    ('age_restriction'      = ANY(v_relevant))
    OR ('dress_code'        = ANY(v_relevant))
    OR ('access_policy'     = ANY(v_relevant))
    OR ('access_requirements' = ANY(v_relevant))
  );
  v_capacity_changed := (
    ('capacity'     = ANY(v_relevant))
    OR ('max_capacity' = ANY(v_relevant))
    OR ('ticket_price' = ANY(v_relevant))
  );
  v_lineup_changed   := (
    ('lineup'    = ANY(v_relevant))
    OR ('artist'   = ANY(v_relevant))
    OR ('artists'  = ANY(v_relevant))
    OR ('speaker'  = ANY(v_relevant))
    OR ('speakers' = ANY(v_relevant))
  );
  v_cancelled        := (
    (NULLIF(COALESCE(p_new->>'status', ''), '') ILIKE 'cancel%')
    OR (COALESCE((p_new->>'is_cancelled')::boolean, false) = true
        AND COALESCE((p_old->>'is_cancelled')::boolean, false) = false)
    OR (NULLIF(COALESCE(p_new->>'cancelled_at', ''), '') IS NOT NULL
        AND NULLIF(COALESCE(p_old->>'cancelled_at', ''), '') IS NULL)
  );

  -- If none of the meaningful fields changed, bail out (even if v_relevant is non-empty)
  IF NOT (v_time_changed OR v_location_changed OR v_policy_changed
          OR v_capacity_changed OR v_lineup_changed OR v_cancelled)
     AND NOT p_force THEN
    RETURN;
  END IF;

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
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;
  IF NULLIF(COALESCE(p_new->>'venue_id', ''), '') IS NOT NULL THEN
    BEGIN
      SELECT * INTO v_new_venue FROM public.venues v WHERE v.id = (p_new->>'venue_id')::uuid;
    EXCEPTION WHEN others THEN NULL;
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
    'event_id',            p_event_id::text,
    'event_title',         COALESCE(p_new->>'title', ''),
    'event_url',           '/event/' || p_event_id::text,
    'changed_fields',      COALESCE(to_jsonb(v_relevant), '[]'::jsonb),
    'diff',                v_diff,
    'old_event_date',      COALESCE(p_old->>'event_date', ''),
    'new_event_date',      COALESCE(p_new->>'event_date', ''),
    'old_venue_id',        COALESCE(p_old->>'venue_id', ''),
    'new_venue_id',        COALESCE(p_new->>'venue_id', ''),
    'old_venue_name',      COALESCE(v_old_venue.name, ''),
    'old_venue_address',   COALESCE(v_old_venue.address, ''),
    'new_venue_name',      COALESCE(v_new_venue.name, ''),
    'new_venue_address',   COALESCE(v_new_venue.address, ''),
    'requires_confirmation', (v_time_changed OR v_location_changed OR v_policy_changed OR v_lineup_changed),
    'event_updated_at',    v_updated_at::text
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
      EXCEPTION WHEN others THEN NULL;
      END;
    ELSIF v_location_changed THEN
      BEGIN
        PERFORM public.enqueue_notification_from_template(r.user_id, 'attendee', 'event_location_changed', v_data);
      EXCEPTION WHEN others THEN NULL;
      END;
    ELSIF v_time_changed THEN
      BEGIN
        PERFORM public.enqueue_notification_from_template(r.user_id, 'attendee', 'event_time_changed', v_data);
      EXCEPTION WHEN others THEN NULL;
      END;
    ELSIF v_policy_changed THEN
      BEGIN
        PERFORM public.enqueue_notification_from_template(r.user_id, 'attendee', 'event_access_policy_changed', v_data);
      EXCEPTION WHEN others THEN NULL;
      END;
    ELSIF v_capacity_changed THEN
      BEGIN
        PERFORM public.enqueue_notification_from_template(r.user_id, 'attendee', 'event_capacity_or_price_changed', v_data);
      EXCEPTION WHEN others THEN NULL;
      END;
    ELSIF v_lineup_changed THEN
      BEGIN
        PERFORM public.enqueue_notification_from_template(r.user_id, 'attendee', 'event_lineup_changed', v_data);
      EXCEPTION WHEN others THEN NULL;
      END;
    ELSE
      BEGIN
        PERFORM public.enqueue_notification_from_template(r.user_id, 'attendee', 'event_updated', v_data);
      EXCEPTION WHEN others THEN NULL;
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

NOTIFY pgrst, 'reload schema';
