CREATE OR REPLACE FUNCTION public.suppress_duplicate_organizer_sales()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_pi text;
  v_ticket_id text;
  v_event_id text;
BEGIN
  IF NEW.role = 'organizer' AND NEW.type = 'organizer_realtime_sale' THEN
    v_pi := NULLIF(COALESCE(NEW.data->>'payment_intent_id', ''), '');
    v_ticket_id := NULLIF(COALESCE(NEW.data->>'ticket_id', ''), '');
    v_event_id := NULLIF(COALESCE(NEW.data->>'event_id', ''), '');

    IF v_pi IS NOT NULL THEN
      IF EXISTS (
        SELECT 1
        FROM public.notifications n
        WHERE n.user_id = NEW.user_id
          AND n.type = 'organizer_realtime_sale'
          AND (n.data->>'payment_intent_id') = v_pi
      ) THEN
        RETURN NULL;
      END IF;
    END IF;

    IF v_ticket_id IS NOT NULL THEN
      IF EXISTS (
        SELECT 1
        FROM public.notifications n
        WHERE n.user_id = NEW.user_id
          AND n.type = 'organizer_realtime_sale'
          AND (n.data->>'ticket_id') = v_ticket_id
      ) THEN
        RETURN NULL;
      END IF;
    END IF;

    IF v_event_id IS NOT NULL THEN
      IF EXISTS (
        SELECT 1
        FROM public.notifications n
        WHERE n.user_id = NEW.user_id
          AND n.type = 'organizer_realtime_sale'
          AND (n.data->>'event_id') = v_event_id
          AND n.created_at > now() - interval '2 minutes'
      ) THEN
        RETURN NULL;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_suppress_duplicate_organizer_sales ON public.notifications;
CREATE TRIGGER trg_suppress_duplicate_organizer_sales
BEFORE INSERT ON public.notifications
FOR EACH ROW
EXECUTE FUNCTION public.suppress_duplicate_organizer_sales();

NOTIFY pgrst, 'reload schema';

