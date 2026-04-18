CREATE TABLE IF NOT EXISTS public.notification_templates (
  key text PRIMARY KEY,
  title_template text NOT NULL,
  body_template text NOT NULL,
  default_priority text DEFAULT 'normal',
  default_channels text[] DEFAULT ARRAY['in_app','push']::text[],
  dedupe_seconds integer DEFAULT 0,
  enabled boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

INSERT INTO public.notification_templates (key, title_template, body_template, default_priority, default_channels, dedupe_seconds, enabled)
VALUES
  ('purchase_completed', '🎟️ Entrada confirmada', 'Tu entrada para "{{event_title}}" está confirmada. La noche te espera.', 'high', ARRAY['in_app','push']::text[], 60, true),
  ('organizer_realtime_sale', '💸 Nueva venta', 'Nueva entrada vendida para "{{event_title}}". El público crece.', 'normal', ARRAY['in_app','push','email']::text[], 0, true),
  ('resale_sold', '💰 Venta en reventa', 'Tu entrada para "{{event_title}}" se ha vendido. La noche sigue su curso.', 'high', ARRAY['in_app','push']::text[], 60, true),
  ('event_reminder_24h', '🌙 Mañana es tu noche', 'Mañana es "{{event_title}}". Tu noche está a punto de empezar.', 'high', ARRAY['in_app','push']::text[], 3600, true),
  ('event_reminder_3h', '⏳ La noche se acerca', 'Faltan pocas horas para "{{event_title}}". Ve preparándote.', 'high', ARRAY['in_app','push']::text[], 1800, true),
  ('event_reminder_30min', '🚪 Es tu momento', 'Las puertas de "{{event_title}}" se abren en breve. Es tu momento.', 'high', ARRAY['in_app','push']::text[], 1800, true),
  ('event_today', '🔥 Hoy es el día', 'Hoy es el día. Esta noche tienes "{{event_title}}".', 'high', ARRAY['in_app','push']::text[], 21600, true),
  ('event_updated', '⚠️ Cambios en tu plan', '"{{event_title}}" ha tenido cambios importantes. Revisa los detalles.', 'high', ARRAY['in_app','push']::text[], 300, true),
  ('event_cancelled', '❌ Evento cancelado', '"{{event_title}}" ha sido cancelado. Recibirás info del reembolso.', 'high', ARRAY['in_app','push']::text[], 300, true),
  ('event_recommendation', '🎶 Plan para tu noche', 'Si te gustó "{{event_previous}}", esta noche "{{event_recommended}}" puede ser para ti.', 'normal', ARRAY['in_app','push']::text[], 86400, true),
  ('refund_completed', '💳 Reembolso completado', 'El reembolso de "{{event_title}}" se ha realizado correctamente.', 'high', ARRAY['in_app','push']::text[], 300, true)
ON CONFLICT (key) DO UPDATE
SET
  title_template = EXCLUDED.title_template,
  body_template = EXCLUDED.body_template,
  default_priority = EXCLUDED.default_priority,
  default_channels = EXCLUDED.default_channels,
  dedupe_seconds = EXCLUDED.dedupe_seconds,
  enabled = EXCLUDED.enabled,
  updated_at = now();

CREATE OR REPLACE FUNCTION public.schedule_event_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  r record;
  v_data jsonb;
  v_venue_name text;
  v_venue_address text;
BEGIN
  FOR r IN
    SELECT DISTINCT
      t.user_id,
      e.id AS event_id,
      e.title AS event_title,
      e.event_date,
      e.venue_id
    FROM public.tickets t
    JOIN public.events e ON e.id = t.event_id
    WHERE t.user_id IS NOT NULL
      AND t.status = 'valid'
      AND e.event_date BETWEEN (now() + interval '23 hours') AND (now() + interval '25 hours')
  LOOP
    v_venue_name := NULL;
    v_venue_address := NULL;
    IF r.venue_id IS NOT NULL THEN
      SELECT v.name, v.address INTO v_venue_name, v_venue_address
      FROM public.venues v
      WHERE v.id = r.venue_id;
    END IF;
    v_data := jsonb_build_object(
      'event_id', r.event_id::text,
      'event_title', COALESCE(r.event_title, ''),
      'event_date', COALESCE(r.event_date::text, ''),
      'venue_name', COALESCE(v_venue_name, ''),
      'venue_address', COALESCE(v_venue_address, '')
    );
    PERFORM public.enqueue_notification_from_template(r.user_id, 'attendee', 'event_reminder_24h', v_data);
  END LOOP;

  FOR r IN
    SELECT DISTINCT
      t.user_id,
      e.id AS event_id,
      e.title AS event_title,
      e.event_date,
      e.venue_id
    FROM public.tickets t
    JOIN public.events e ON e.id = t.event_id
    WHERE t.user_id IS NOT NULL
      AND t.status = 'valid'
      AND e.event_date BETWEEN (now() + interval '2 hours 45 minutes') AND (now() + interval '3 hours 15 minutes')
  LOOP
    v_venue_name := NULL;
    v_venue_address := NULL;
    IF r.venue_id IS NOT NULL THEN
      SELECT v.name, v.address INTO v_venue_name, v_venue_address
      FROM public.venues v
      WHERE v.id = r.venue_id;
    END IF;
    v_data := jsonb_build_object(
      'event_id', r.event_id::text,
      'event_title', COALESCE(r.event_title, ''),
      'event_date', COALESCE(r.event_date::text, ''),
      'venue_name', COALESCE(v_venue_name, ''),
      'venue_address', COALESCE(v_venue_address, '')
    );
    PERFORM public.enqueue_notification_from_template(r.user_id, 'attendee', 'event_reminder_3h', v_data);
  END LOOP;

  FOR r IN
    SELECT DISTINCT
      t.user_id,
      e.id AS event_id,
      e.title AS event_title,
      e.event_date,
      e.venue_id
    FROM public.tickets t
    JOIN public.events e ON e.id = t.event_id
    WHERE t.user_id IS NOT NULL
      AND t.status = 'valid'
      AND e.event_date BETWEEN (now() + interval '20 minutes') AND (now() + interval '40 minutes')
  LOOP
    v_venue_name := NULL;
    v_venue_address := NULL;
    IF r.venue_id IS NOT NULL THEN
      SELECT v.name, v.address INTO v_venue_name, v_venue_address
      FROM public.venues v
      WHERE v.id = r.venue_id;
    END IF;
    v_data := jsonb_build_object(
      'event_id', r.event_id::text,
      'event_title', COALESCE(r.event_title, ''),
      'event_date', COALESCE(r.event_date::text, ''),
      'venue_name', COALESCE(v_venue_name, ''),
      'venue_address', COALESCE(v_venue_address, '')
    );
    PERFORM public.enqueue_notification_from_template(r.user_id, 'attendee', 'event_reminder_30min', v_data);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.schedule_event_today()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  r record;
  v_data jsonb;
BEGIN
  FOR r IN
    SELECT DISTINCT
      t.user_id,
      e.id AS event_id,
      e.title AS event_title,
      e.event_date
    FROM public.tickets t
    JOIN public.events e ON e.id = t.event_id
    WHERE t.user_id IS NOT NULL
      AND t.status = 'valid'
      AND e.event_date >= date_trunc('day', now())
      AND e.event_date < date_trunc('day', now()) + interval '1 day'
  LOOP
    v_data := jsonb_build_object(
      'event_id', r.event_id::text,
      'event_title', COALESCE(r.event_title, ''),
      'event_date', COALESCE(r.event_date::text, '')
    );
    PERFORM public.enqueue_notification_from_template(r.user_id, 'attendee', 'event_today', v_data);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.schedule_event_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM public.schedule_event_notifications();
END;
$$;

CREATE OR REPLACE FUNCTION public.schedule_event_recommendations()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  u record;
  v_prev record;
  v_rec record;
  v_data jsonb;
BEGIN
  FOR u IN
    SELECT DISTINCT t.user_id
    FROM public.tickets t
    WHERE t.user_id IS NOT NULL
  LOOP
    SELECT e.id AS event_id, e.title AS event_title, e.venue_id, e.event_type, e.theme, e.event_date
    INTO v_prev
    FROM public.tickets t
    JOIN public.events e ON e.id = t.event_id
    WHERE t.user_id = u.user_id
      AND e.event_date < now()
    ORDER BY e.event_date DESC
    LIMIT 1;

    IF v_prev.event_id IS NULL THEN
      CONTINUE;
    END IF;

    SELECT e.id AS event_id, e.title AS event_title
    INTO v_rec
    FROM public.events e
    WHERE e.event_date > now()
      AND e.event_date < now() + interval '14 days'
      AND (
        (v_prev.venue_id IS NOT NULL AND e.venue_id = v_prev.venue_id) OR
        (v_prev.event_type IS NOT NULL AND e.event_type = v_prev.event_type) OR
        (v_prev.theme IS NOT NULL AND e.theme = v_prev.theme)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.tickets t2
        WHERE t2.user_id = u.user_id
          AND t2.event_id = e.id
          AND t2.status = 'valid'
      )
    ORDER BY e.event_date ASC
    LIMIT 1;

    IF v_rec.event_id IS NULL THEN
      CONTINUE;
    END IF;

    v_data := jsonb_build_object(
      'event_previous', COALESCE(v_prev.event_title, ''),
      'event_recommended', COALESCE(v_rec.event_title, ''),
      'event_id', v_rec.event_id::text
    );
    PERFORM public.enqueue_notification_from_template(u.user_id, 'attendee', 'event_recommendation', v_data);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_refund_completed(p_user_id uuid, p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event_title text;
  v_data jsonb;
BEGIN
  SELECT e.title INTO v_event_title
  FROM public.events e
  WHERE e.id = p_event_id;

  v_data := jsonb_build_object(
    'event_id', p_event_id::text,
    'event_title', COALESCE(v_event_title, 'este evento')
  );
  PERFORM public.enqueue_notification_from_template(p_user_id, 'attendee', 'refund_completed', v_data);
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_event_updates_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  r record;
  v_data jsonb;
BEGIN
  IF (OLD.event_date IS DISTINCT FROM NEW.event_date) OR (OLD.title IS DISTINCT FROM NEW.title) OR (OLD.venue_id IS DISTINCT FROM NEW.venue_id) THEN
    FOR r IN
      SELECT DISTINCT t.user_id
      FROM public.tickets t
      WHERE t.event_id = NEW.id
        AND t.user_id IS NOT NULL
        AND t.status = 'valid'
    LOOP
      v_data := jsonb_build_object(
        'event_id', NEW.id::text,
        'event_title', COALESCE(NEW.title, ''),
        'old_event_title', COALESCE(OLD.title, ''),
        'old_event_date', COALESCE(OLD.event_date::text, ''),
        'new_event_date', COALESCE(NEW.event_date::text, '')
      );
      PERFORM public.enqueue_notification_from_template(r.user_id, 'attendee', 'event_updated', v_data);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_event_update ON public.events;
CREATE TRIGGER on_event_update
AFTER UPDATE ON public.events
FOR EACH ROW
EXECUTE FUNCTION public.handle_event_updates_notification();

CREATE OR REPLACE FUNCTION public.handle_event_delete_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  r record;
  v_data jsonb;
BEGIN
  FOR r IN
    SELECT DISTINCT t.user_id
    FROM public.tickets t
    WHERE t.event_id = OLD.id
      AND t.user_id IS NOT NULL
      AND t.status = 'valid'
  LOOP
    v_data := jsonb_build_object(
      'event_id', OLD.id::text,
      'event_title', COALESCE(OLD.title, '')
    );
    PERFORM public.enqueue_notification_from_template(r.user_id, 'attendee', 'event_cancelled', v_data);
  END LOOP;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS on_event_delete ON public.events;
CREATE TRIGGER on_event_delete
BEFORE DELETE ON public.events
FOR EACH ROW
EXECUTE FUNCTION public.handle_event_delete_notification();

CREATE OR REPLACE FUNCTION public."triggerPurchaseNotifications"(
  p_buyer_id uuid,
  p_organizer_id uuid,
  p_event_id uuid,
  p_event_title text,
  p_quantity int,
  p_payment_intent_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_data jsonb;
BEGIN
  v_data := jsonb_build_object(
    'event_id', p_event_id::text,
    'event_title', COALESCE(p_event_title, ''),
    'quantity', COALESCE(p_quantity, 1)::text,
    'payment_intent_id', COALESCE(p_payment_intent_id, '')
  );
  IF p_buyer_id IS NOT NULL THEN
    PERFORM public.enqueue_notification_from_template(p_buyer_id, 'attendee', 'purchase_completed', v_data);
  END IF;
  IF p_organizer_id IS NOT NULL THEN
    PERFORM public.enqueue_notification_from_template(p_organizer_id, 'organizer', 'organizer_realtime_sale', v_data);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public."triggerResaleNotifications"(
  p_buyer_id uuid,
  p_seller_id uuid,
  p_organizer_id uuid,
  p_event_id uuid,
  p_event_title text,
  p_ticket_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_data jsonb;
BEGIN
  v_data := jsonb_build_object(
    'event_id', p_event_id::text,
    'event_title', COALESCE(p_event_title, ''),
    'ticket_id', COALESCE(p_ticket_id::text, ''),
    'quantity', '1'
  );
  IF p_seller_id IS NOT NULL AND p_seller_id IS DISTINCT FROM p_buyer_id THEN
    PERFORM public.enqueue_notification_from_template(p_seller_id, 'attendee', 'resale_sold', v_data);
  END IF;
  IF p_organizer_id IS NOT NULL THEN
    PERFORM public.enqueue_notification_from_template(p_organizer_id, 'organizer', 'organizer_realtime_sale', v_data);
  END IF;
  IF p_buyer_id IS NOT NULL THEN
    PERFORM public.enqueue_notification_from_template(p_buyer_id, 'attendee', 'purchase_completed', v_data);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public."triggerEventReminders"()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM public.schedule_event_notifications();
END;
$$;

CREATE OR REPLACE FUNCTION public."triggerEventUpdates"(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  e public.events%ROWTYPE;
  r record;
  v_data jsonb;
BEGIN
  SELECT * INTO e FROM public.events WHERE id = p_event_id;
  IF e.id IS NULL THEN
    RETURN;
  END IF;
  FOR r IN
    SELECT DISTINCT t.user_id
    FROM public.tickets t
    WHERE t.event_id = e.id AND t.user_id IS NOT NULL AND t.status = 'valid'
  LOOP
    v_data := jsonb_build_object('event_id', e.id::text, 'event_title', COALESCE(e.title, ''));
    PERFORM public.enqueue_notification_from_template(r.user_id, 'attendee', 'event_updated', v_data);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public."triggerRecommendations"()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM public.schedule_event_recommendations();
END;
$$;

NOTIFY pgrst, 'reload schema';
