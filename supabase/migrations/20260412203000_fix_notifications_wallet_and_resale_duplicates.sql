DROP TRIGGER IF EXISTS trg_notify_resale_buyer_and_seller ON public.resale_transactions;
DROP TRIGGER IF EXISTS trg_notify_resale_buyer_fallback ON public.resale_transactions;
DROP TRIGGER IF EXISTS trg_notify_resale_transaction_insert ON public.resale_transactions;

UPDATE public.notification_templates
SET dedupe_seconds = 0,
    updated_at = now()
WHERE key IN ('purchase_completed', 'resale_sold');

CREATE OR REPLACE FUNCTION public.suppress_duplicate_attendee_purchase_resale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_pi text;
  v_ticket_id text;
  v_listing_id text;
BEGIN
  IF NEW.role IS DISTINCT FROM 'attendee' THEN
    RETURN NEW;
  END IF;

  IF NEW.type NOT IN ('purchase_completed', 'resale_sold') THEN
    RETURN NEW;
  END IF;

  v_pi := NULLIF(COALESCE(NEW.data->>'payment_intent_id', ''), '');
  v_ticket_id := NULLIF(COALESCE(NEW.data->>'ticket_id', ''), '');
  v_listing_id := NULLIF(COALESCE(NEW.data->>'listing_id', ''), '');

  IF v_pi IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.notifications n
      WHERE n.user_id = NEW.user_id
        AND n.type = NEW.type
        AND (n.data->>'payment_intent_id') = v_pi
    ) THEN
      RETURN NULL;
    END IF;
  END IF;

  IF v_listing_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.notifications n
      WHERE n.user_id = NEW.user_id
        AND n.type = NEW.type
        AND (n.data->>'listing_id') = v_listing_id
    ) THEN
      RETURN NULL;
    END IF;
  END IF;

  IF v_ticket_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.notifications n
      WHERE n.user_id = NEW.user_id
        AND n.type = NEW.type
        AND (n.data->>'ticket_id') = v_ticket_id
    ) THEN
      RETURN NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aaa_suppress_duplicate_attendee_purchase_resale ON public.notifications;
CREATE TRIGGER trg_aaa_suppress_duplicate_attendee_purchase_resale
BEFORE INSERT ON public.notifications
FOR EACH ROW
EXECUTE FUNCTION public.suppress_duplicate_attendee_purchase_resale();

NOTIFY pgrst, 'reload schema';
