CREATE OR REPLACE FUNCTION public.fill_notification_title_body_from_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_message text;
BEGIN
  v_message := NULLIF(COALESCE(to_jsonb(NEW)->>'message', ''), '');

  IF (NEW.title IS NULL OR btrim(NEW.title) = '') THEN
    IF v_message IS NOT NULL THEN
      NEW.title := 'Notificación';
    END IF;
  END IF;

  IF (NEW.body IS NULL OR btrim(NEW.body) = '') THEN
    IF v_message IS NOT NULL THEN
      NEW.body := v_message;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fill_notification_title_body ON public.notifications;
CREATE TRIGGER trg_fill_notification_title_body
BEFORE INSERT ON public.notifications
FOR EACH ROW
EXECUTE FUNCTION public.fill_notification_title_body_from_message();

NOTIFY pgrst, 'reload schema';

