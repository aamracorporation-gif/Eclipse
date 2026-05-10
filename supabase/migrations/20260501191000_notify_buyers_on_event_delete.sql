CREATE OR REPLACE FUNCTION public.notify_event_deleted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  r record;
  v_data jsonb;
BEGIN
  v_data := jsonb_build_object(
    'event_id', OLD.id::text,
    'event_title', COALESCE(OLD.title, ''),
    'event_url', '/event/' || OLD.id::text,
    'reason', COALESCE(NULLIF(OLD.cancellation_reason, ''), 'Evento cancelado')
  );

  FOR r IN
    SELECT DISTINCT t.user_id
    FROM public.tickets t
    WHERE t.event_id = OLD.id
      AND t.user_id IS NOT NULL
      AND t.status = 'valid'
  LOOP
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
EXECUTE FUNCTION public.notify_event_deleted();

NOTIFY pgrst, 'reload schema';
