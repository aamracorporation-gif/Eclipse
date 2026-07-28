-- Drop the old 7-param push_notify overload that caused an ambiguity error in
-- every trigger call, silently swallowing all notifications.
DROP FUNCTION IF EXISTS public.push_notify(uuid, text, text, text, jsonb, integer, text[]);

-- Fix: dispatch-notifications was creating event_updated notifications via
-- enqueueEventUpdate on every organizer save, duplicating the DB trigger.
-- Now all event change notifications go through on_event_updated() only.
-- Also expanded to fire on title changes (general "event updated" category).

CREATE OR REPLACE FUNCTION public.on_event_updated()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  r        record;
  v_etitle text;
  v_type   text;
  v_title  text;
  v_body   text;
  v_data   jsonb;
BEGIN
  -- Only notify for real organizer actions:
  --   1. Event cancelled
  --   2. Date/time changed
  --   3. Venue changed
  --   4. Title changed (general event update)
  -- Anything else (counters, updated_at, revenue, etc.) → silent exit.

  IF NEW.event_date    IS NOT DISTINCT FROM OLD.event_date
     AND NEW.venue_id  IS NOT DISTINCT FROM OLD.venue_id
     AND NEW.title     IS NOT DISTINCT FROM OLD.title
     AND COALESCE(NEW.status,'') NOT ILIKE 'cancel%'
  THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.status,'') ILIKE 'cancel%'
     AND COALESCE(OLD.status,'') NOT ILIKE 'cancel%' THEN
    v_type  := 'event_cancelled';
    v_title := '❌ Evento cancelado';
  ELSIF NEW.event_date IS DISTINCT FROM OLD.event_date THEN
    v_type  := 'event_date_changed';
    v_title := '⏰ Cambio de fecha';
  ELSIF NEW.venue_id IS DISTINCT FROM OLD.venue_id THEN
    v_type  := 'event_venue_changed';
    v_title := '📍 Cambio de ubicación';
  ELSIF NEW.title IS DISTINCT FROM OLD.title THEN
    v_type  := 'event_updated';
    v_title := '🔁 Cambios en el evento';
  ELSE
    RETURN NEW;
  END IF;

  v_etitle := COALESCE(NULLIF(NEW.title,''), 'el evento');

  v_body := CASE v_type
    WHEN 'event_cancelled'    THEN '"' || v_etitle || '" ha sido cancelado. Recibirás info sobre el reembolso.'
    WHEN 'event_date_changed' THEN '"' || v_etitle || '" cambió de fecha/hora. Revisa los detalles antes de ir.'
    WHEN 'event_venue_changed' THEN '"' || v_etitle || '" cambió de lugar. Abre el mapa para ver el nuevo sitio.'
    WHEN 'event_updated'      THEN 'Hay cambios en "' || v_etitle || '". Revisa los nuevos detalles.'
    ELSE ''
  END;

  v_data := jsonb_build_object(
    'type',v_type,'event_id',NEW.id::text,'eventId',NEW.id::text,'event_title',v_etitle
  );

  FOR r IN
    SELECT DISTINCT t.user_id
    FROM public.tickets t
    WHERE t.event_id  = NEW.id
      AND t.user_id IS NOT NULL
      AND COALESCE(t.status,'') IN ('valid','active')
  LOOP
    PERFORM public.push_notify(
      r.user_id, v_type, v_title, v_body, v_data,
      60  -- 60s dedup prevents storm if organizer saves multiple times in a row
    );
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
