DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'event_id'
  ) THEN
    ALTER TABLE public.notifications ADD COLUMN event_id uuid;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notification_deliveries' AND column_name = 'next_retry_at'
  ) THEN
    ALTER TABLE public.notification_deliveries
      ADD COLUMN next_retry_at timestamptz DEFAULT now();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notification_deliveries' AND column_name = 'last_attempt_at'
  ) THEN
    ALTER TABLE public.notification_deliveries
      ADD COLUMN last_attempt_at timestamptz;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'notifications_event_id_fkey'
  ) THEN
    BEGIN
      ALTER TABLE public.notifications
        ADD CONSTRAINT notifications_event_id_fkey
        FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE SET NULL;
    EXCEPTION WHEN undefined_table THEN
      NULL;
    END;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_notifications_event_id ON public.notifications(event_id);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_due
ON public.notification_deliveries(channel, status, next_retry_at)
WHERE status = 'pending';

DROP TRIGGER IF EXISTS trg_log_notification_delivery_event ON public.notification_deliveries;
CREATE TRIGGER trg_log_notification_delivery_event
AFTER UPDATE OF status, attempts, last_error, next_retry_at ON public.notification_deliveries
FOR EACH ROW
EXECUTE FUNCTION public.log_notification_delivery_event();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tickets' AND column_name = 'event_update_notified_at'
  ) THEN
    ALTER TABLE public.tickets ADD COLUMN event_update_notified_at timestamptz;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.event_notifications_log (
  event_id uuid NOT NULL,
  user_id uuid NOT NULL,
  event_updated_at timestamptz NOT NULL,
  notified_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id, event_updated_at)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE public.events ADD COLUMN updated_at timestamptz DEFAULT now();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'venues' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE public.venues ADD COLUMN updated_at timestamptz DEFAULT now();
  END IF;
END $$;

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
  v_allowed text[] := ARRAY[
    'title',
    'description',
    'event_date',
    'venue_id',
    'status',
    'cancelled_at',
    'is_cancelled'
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
  v_updated_at timestamptz;
  v_available_changed boolean := false;
  v_sold_changed boolean := false;
  v_already_notified boolean := false;
  v_has_ticket_status boolean := false;
  v_sql text;
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
    WHERE c = ANY(v_allowed)
  );

  IF COALESCE(array_length(v_relevant, 1), 0) = 0 AND NOT p_force THEN
    RETURN;
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

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tickets' AND column_name = 'ticket_status'
  ) INTO v_has_ticket_status;

  IF v_has_ticket_status THEN
    v_sql := $q$
      SELECT DISTINCT t.user_id AS user_id
      FROM public.tickets t
      WHERE t.event_id = $1
        AND t.user_id IS NOT NULL
        AND (t.status IN ('valid','active') OR t.ticket_status = 'active')
      UNION
      SELECT DISTINCT p.id AS user_id
      FROM public.tickets t
      JOIN public.profiles p
        ON lower(p.email) = lower(t.buyer_email)
      WHERE t.event_id = $1
        AND t.user_id IS NULL
        AND NULLIF(COALESCE(t.buyer_email, ''), '') IS NOT NULL
        AND (t.status IN ('valid','active') OR t.ticket_status = 'active')
    $q$;
  ELSE
    v_sql := $q$
      SELECT DISTINCT t.user_id AS user_id
      FROM public.tickets t
      WHERE t.event_id = $1
        AND t.user_id IS NOT NULL
        AND t.status IN ('valid','active')
      UNION
      SELECT DISTINCT p.id AS user_id
      FROM public.tickets t
      JOIN public.profiles p
        ON lower(p.email) = lower(t.buyer_email)
      WHERE t.event_id = $1
        AND t.user_id IS NULL
        AND NULLIF(COALESCE(t.buyer_email, ''), '') IS NOT NULL
        AND t.status IN ('valid','active')
    $q$;
  END IF;

  FOR r IN EXECUTE v_sql USING p_event_id LOOP
    IF NOT p_force THEN
      SELECT EXISTS(
        SELECT 1
        FROM public.event_notifications_log l
        WHERE l.event_id = p_event_id
          AND l.user_id = r.user_id
          AND l.event_updated_at = v_updated_at
      ) INTO v_already_notified;

      IF v_already_notified THEN
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

    INSERT INTO public.event_notifications_log(event_id, user_id, event_updated_at)
    VALUES (p_event_id, r.user_id, v_updated_at)
    ON CONFLICT DO NOTHING;

    IF v_has_ticket_status THEN
      UPDATE public.tickets
      SET event_update_notified_at = v_updated_at
      WHERE event_id = p_event_id
        AND (status IN ('valid','active') OR ticket_status = 'active')
        AND (
          user_id = r.user_id
          OR (user_id IS NULL AND lower(buyer_email) = (SELECT lower(p.email) FROM public.profiles p WHERE p.id = r.user_id LIMIT 1))
        );
    ELSE
      UPDATE public.tickets
      SET event_update_notified_at = v_updated_at
      WHERE event_id = p_event_id
        AND status IN ('valid','active')
        AND (
          user_id = r.user_id
          OR (user_id IS NULL AND lower(buyer_email) = (SELECT lower(p.email) FROM public.profiles p WHERE p.id = r.user_id LIMIT 1))
        );
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_event_updates_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM public.send_event_update_notifications(NEW.id, to_jsonb(OLD), to_jsonb(NEW), false);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_event_update ON public.events;
CREATE TRIGGER on_event_update
AFTER UPDATE ON public.events
FOR EACH ROW
EXECUTE FUNCTION public.handle_event_updates_notification();

CREATE OR REPLACE FUNCTION public.get_event_notification_metrics(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sent int := 0;
  v_failed int := 0;
  v_pending int := 0;
  v_push_sent int := 0;
  v_email_sent int := 0;
  v_sms_sent int := 0;
  v_read int := 0;
  v_avg_seconds_to_read numeric := NULL;
BEGIN
  SELECT
    count(*) FILTER (WHERE d.status = 'sent'),
    count(*) FILTER (WHERE d.status = 'failed'),
    count(*) FILTER (WHERE d.status = 'pending'),
    count(*) FILTER (WHERE d.status = 'sent' AND d.channel = 'push'),
    count(*) FILTER (WHERE d.status = 'sent' AND d.channel = 'email'),
    count(*) FILTER (WHERE d.status = 'sent' AND d.channel = 'sms')
  INTO v_sent, v_failed, v_pending, v_push_sent, v_email_sent, v_sms_sent
  FROM public.notification_deliveries d
  JOIN public.notifications n ON n.id = d.notification_id
  WHERE NULLIF(COALESCE(n.data->>'event_id', ''), '')::uuid = p_event_id;

  SELECT
    count(*) FILTER (WHERE n.read_at IS NOT NULL OR n.status = 'read'),
    avg(extract(epoch from (n.read_at - n.created_at))) FILTER (WHERE n.read_at IS NOT NULL)
  INTO v_read, v_avg_seconds_to_read
  FROM public.notifications n
  WHERE NULLIF(COALESCE(n.data->>'event_id', ''), '')::uuid = p_event_id;

  RETURN jsonb_build_object(
    'event_id', p_event_id::text,
    'deliveries', jsonb_build_object(
      'sent', v_sent,
      'failed', v_failed,
      'pending', v_pending,
      'push_sent', v_push_sent,
      'email_sent', v_email_sent,
      'sms_sent', v_sms_sent
    ),
    'reads', jsonb_build_object(
      'read', v_read,
      'avg_seconds_to_read', v_avg_seconds_to_read
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_event_notification_metrics(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_notification_metrics(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.notify_event_location_changed_on_venue_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  e record;
  r record;
  v_updated_at timestamptz := now();
  v_data jsonb;
  v_already_notified boolean := false;
  v_has_ticket_status boolean := false;
  v_sql text;
BEGIN
  IF (OLD.name IS NOT DISTINCT FROM NEW.name)
    AND (OLD.address IS NOT DISTINCT FROM NEW.address)
    AND (OLD.latitude IS NOT DISTINCT FROM NEW.latitude)
    AND (OLD.longitude IS NOT DISTINCT FROM NEW.longitude) THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tickets' AND column_name = 'ticket_status'
  ) INTO v_has_ticket_status;

  IF v_has_ticket_status THEN
    v_sql := $q$
      SELECT DISTINCT t.user_id AS user_id
      FROM public.tickets t
      WHERE t.event_id = $1
        AND t.user_id IS NOT NULL
        AND (t.status IN ('valid','active') OR t.ticket_status = 'active')
      UNION
      SELECT DISTINCT p.id AS user_id
      FROM public.tickets t
      JOIN public.profiles p
        ON lower(p.email) = lower(t.buyer_email)
      WHERE t.event_id = $1
        AND t.user_id IS NULL
        AND NULLIF(COALESCE(t.buyer_email, ''), '') IS NOT NULL
        AND (t.status IN ('valid','active') OR t.ticket_status = 'active')
    $q$;
  ELSE
    v_sql := $q$
      SELECT DISTINCT t.user_id AS user_id
      FROM public.tickets t
      WHERE t.event_id = $1
        AND t.user_id IS NOT NULL
        AND t.status IN ('valid','active')
      UNION
      SELECT DISTINCT p.id AS user_id
      FROM public.tickets t
      JOIN public.profiles p
        ON lower(p.email) = lower(t.buyer_email)
      WHERE t.event_id = $1
        AND t.user_id IS NULL
        AND NULLIF(COALESCE(t.buyer_email, ''), '') IS NOT NULL
        AND t.status IN ('valid','active')
    $q$;
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
          'old', jsonb_build_object(
            'name', COALESCE(OLD.name, ''),
            'address', COALESCE(OLD.address, ''),
            'latitude', COALESCE(OLD.latitude::text, ''),
            'longitude', COALESCE(OLD.longitude::text, '')
          ),
          'new', jsonb_build_object(
            'name', COALESCE(NEW.name, ''),
            'address', COALESCE(NEW.address, ''),
            'latitude', COALESCE(NEW.latitude::text, ''),
            'longitude', COALESCE(NEW.longitude::text, '')
          )
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

    FOR r IN EXECUTE v_sql USING e.id LOOP
      SELECT EXISTS(
        SELECT 1
        FROM public.event_notifications_log l
        WHERE l.event_id = e.id
          AND l.user_id = r.user_id
          AND l.event_updated_at = v_updated_at
      ) INTO v_already_notified;

      IF v_already_notified THEN
        CONTINUE;
      END IF;

      BEGIN
        PERFORM public.enqueue_notification_from_template(r.user_id, 'attendee', 'event_location_changed', v_data);
      EXCEPTION WHEN others THEN
        NULL;
      END;

      INSERT INTO public.event_notifications_log(event_id, user_id, event_updated_at)
      VALUES (e.id, r.user_id, v_updated_at)
      ON CONFLICT DO NOTHING;

      IF v_has_ticket_status THEN
        UPDATE public.tickets
        SET event_update_notified_at = v_updated_at
        WHERE event_id = e.id
          AND (status IN ('valid','active') OR ticket_status = 'active')
          AND (
            user_id = r.user_id
            OR (user_id IS NULL AND lower(buyer_email) = (SELECT lower(p.email) FROM public.profiles p WHERE p.id = r.user_id LIMIT 1))
          );
      ELSE
        UPDATE public.tickets
        SET event_update_notified_at = v_updated_at
        WHERE event_id = e.id
          AND status IN ('valid','active')
          AND (
            user_id = r.user_id
            OR (user_id IS NULL AND lower(buyer_email) = (SELECT lower(p.email) FROM public.profiles p WHERE p.id = r.user_id LIMIT 1))
          );
      END IF;
    END LOOP;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_venue_update_notify_event_buyers ON public.venues;
CREATE TRIGGER trg_venue_update_notify_event_buyers
AFTER UPDATE OF name, address, latitude, longitude ON public.venues
FOR EACH ROW
EXECUTE FUNCTION public.notify_event_location_changed_on_venue_update();

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_events_set_updated_at ON public.events;
CREATE TRIGGER trg_events_set_updated_at
BEFORE UPDATE ON public.events
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_venues_set_updated_at ON public.venues;
CREATE TRIGGER trg_venues_set_updated_at
BEFORE UPDATE ON public.venues
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS on_event_update ON public.events;
CREATE TRIGGER on_event_update
AFTER UPDATE ON public.events
FOR EACH ROW
EXECUTE FUNCTION public.handle_event_updates_notification();

UPDATE public.notification_templates
SET
  title_template = replace(title_template, '{{even_title}}', '{{event_title}}'),
  body_template = replace(body_template, '{{even_title}}', '{{event_title}}'),
  updated_at = now()
WHERE title_template LIKE '%{{even_title}}%' OR body_template LIKE '%{{even_title}}%';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'notification_template_translations'
  ) THEN
    UPDATE public.notification_template_translations
    SET
      title_template = replace(title_template, '{{even_title}}', '{{event_title}}'),
      body_template = replace(body_template, '{{even_title}}', '{{event_title}}')
    WHERE title_template LIKE '%{{even_title}}%' OR body_template LIKE '%{{even_title}}%';
  END IF;
END $$;

UPDATE public.notification_templates
SET
  title_template = 'El evento al que asistirás ha sido actualizado',
  body_template = 'Revisa los cambios en fecha, hora o ubicación.',
  default_priority = 'high',
  default_channels = ARRAY['in_app','push']::text[],
  dedupe_seconds = 60,
  enabled = true,
  updated_at = now()
WHERE key = 'event_updated';

DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_net;
  EXCEPTION WHEN others THEN
    NULL;
  END;
END $$;

CREATE OR REPLACE FUNCTION public.dispatch_notifications_async()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url text := 'https://zurbdrfmwjqbrscairub.supabase.co/functions/v1/dispatch-notifications';
BEGIN
  IF to_regproc('net.http_post') IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM net.http_post(
    url := v_url,
    body := jsonb_build_object('limit', 500),
    params := '{}'::jsonb,
    headers := '{"Content-Type":"application/json"}'::jsonb,
    timeout_milliseconds := 2000
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_dispatch_notifications_after_event_update ON public.events;
CREATE TRIGGER trg_dispatch_notifications_after_event_update
AFTER UPDATE OF title, description, event_date, venue_id, status, cancelled_at, is_cancelled ON public.events
FOR EACH STATEMENT
EXECUTE FUNCTION public.dispatch_notifications_async();

DROP TRIGGER IF EXISTS trg_dispatch_notifications_after_venue_update ON public.venues;
CREATE TRIGGER trg_dispatch_notifications_after_venue_update
AFTER UPDATE OF name, address, latitude, longitude ON public.venues
FOR EACH STATEMENT
EXECUTE FUNCTION public.dispatch_notifications_async();

NOTIFY pgrst, 'reload schema';
