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

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  BEGIN
    NEW.updated_at := now();
  EXCEPTION WHEN undefined_column THEN
    NULL;
  END;
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

    FOR r IN
      (
        SELECT DISTINCT t.user_id AS user_id
        FROM public.tickets t
        WHERE t.event_id = e.id
          AND t.user_id IS NOT NULL
          AND t.status = 'valid'
      )
      UNION
      (
        SELECT DISTINCT p.id AS user_id
        FROM public.tickets t
        JOIN public.profiles p
          ON lower(p.email) = lower(t.buyer_email)
        WHERE t.event_id = e.id
          AND t.user_id IS NULL
          AND NULLIF(COALESCE(t.buyer_email, ''), '') IS NOT NULL
          AND t.status = 'valid'
      )
    LOOP
      BEGIN
        PERFORM public.enqueue_notification_from_template(r.user_id, 'attendee', 'event_location_changed', v_data);
      EXCEPTION WHEN others THEN
        NULL;
      END;
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

INSERT INTO public.notification_templates (key, title_template, body_template, default_priority, default_channels, dedupe_seconds, enabled)
VALUES
  ('event_location_changed', '📍 Cambio de ubicación', '"{{event_title}}" cambió de ubicación. Abre el mapa para llegar sin problemas.', 'high', ARRAY['in_app','push','email','sms']::text[], 0, true)
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
