CREATE OR REPLACE FUNCTION public.suppress_duplicate_attendee_purchase_resale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_pi text;
  v_ticket_id text;
  v_listing_id text;
  v_seller_id uuid;
  v_buyer_id uuid;
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
  v_seller_id := NULLIF(COALESCE(NEW.data->>'seller_id', ''), '')::uuid;
  v_buyer_id := NULLIF(COALESCE(NEW.data->>'buyer_id', ''), '')::uuid;

  IF NEW.type = 'resale_sold' AND v_seller_id IS NOT NULL AND NEW.user_id IS DISTINCT FROM v_seller_id THEN
    RETURN NULL;
  END IF;

  IF NEW.type = 'purchase_completed' AND v_buyer_id IS NOT NULL AND NEW.user_id IS DISTINCT FROM v_buyer_id THEN
    RETURN NULL;
  END IF;

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

UPDATE public.notification_templates
SET
  title_template = '🎟️ Compra realizada con éxito',
  body_template = 'Tu compra para "{{event_title}}" se ha confirmado. La noche te espera.',
  updated_at = now()
WHERE key = 'purchase_completed';

NOTIFY pgrst, 'reload schema';
