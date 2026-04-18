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
  v_inferred_seller_id uuid;
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

  v_inferred_seller_id := v_seller_id;

  IF v_inferred_seller_id IS NULL AND v_listing_id IS NOT NULL THEN
    SELECT rl.seller_id INTO v_inferred_seller_id
    FROM public.resale_listings rl
    WHERE rl.id = v_listing_id::uuid;
  END IF;

  IF v_inferred_seller_id IS NULL AND v_pi IS NOT NULL THEN
    SELECT rl.seller_id INTO v_inferred_seller_id
    FROM public.payment_transactions pt
    JOIN public.resale_listings rl ON rl.id = (pt.metadata->>'listing_id')::uuid
    WHERE pt.kind = 'resale_ticket'
      AND pt.stripe_payment_intent_id = v_pi
    ORDER BY pt.created_at DESC
    LIMIT 1;
  END IF;

  IF v_inferred_seller_id IS NULL AND v_ticket_id IS NOT NULL THEN
    SELECT rl.seller_id INTO v_inferred_seller_id
    FROM public.resale_listings rl
    WHERE rl.ticket_id = v_ticket_id::uuid
    ORDER BY rl.updated_at DESC NULLS LAST, rl.created_at DESC
    LIMIT 1;
  END IF;

  IF NEW.type = 'resale_sold' THEN
    IF v_inferred_seller_id IS NOT NULL AND NEW.user_id IS DISTINCT FROM v_inferred_seller_id THEN
      RETURN NULL;
    END IF;
    IF v_inferred_seller_id IS NULL AND v_buyer_id IS NOT NULL AND NEW.user_id IS DISTINCT FROM v_buyer_id THEN
      RETURN NEW;
    END IF;
    IF v_inferred_seller_id IS NULL AND v_buyer_id IS NOT NULL AND NEW.user_id IS NOT DISTINCT FROM v_buyer_id THEN
      RETURN NULL;
    END IF;
  END IF;

  IF NEW.type = 'purchase_completed' THEN
    IF v_buyer_id IS NOT NULL AND NEW.user_id IS DISTINCT FROM v_buyer_id THEN
      RETURN NULL;
    END IF;
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

NOTIFY pgrst, 'reload schema';
