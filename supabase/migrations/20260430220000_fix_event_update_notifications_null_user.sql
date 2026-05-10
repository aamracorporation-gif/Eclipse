CREATE OR REPLACE FUNCTION public.handle_event_updates_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  r record;
  v_data jsonb;
BEGIN
  IF (OLD.event_date IS DISTINCT FROM NEW.event_date)
     OR (OLD.title IS DISTINCT FROM NEW.title)
     OR (OLD.venue_id IS DISTINCT FROM NEW.venue_id) THEN
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
      BEGIN
        PERFORM public.enqueue_notification_from_template(r.user_id, 'attendee', 'event_modified', v_data);
      EXCEPTION WHEN others THEN
        NULL;
      END;
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
    BEGIN
      PERFORM public.enqueue_notification_from_template(r.user_id, 'attendee', 'event_cancelled', v_data);
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END LOOP;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS on_event_delete ON public.events;
CREATE TRIGGER on_event_delete
BEFORE DELETE ON public.events
FOR EACH ROW
EXECUTE FUNCTION public.handle_event_delete_notification();

NOTIFY pgrst, 'reload schema';
