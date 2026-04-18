CREATE OR REPLACE FUNCTION public.handle_payment_fulfilled_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event public.events%ROWTYPE;
  v_qty int;
  v_name text;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'fulfilled' AND OLD.status IS DISTINCT FROM 'fulfilled' AND NEW.kind = 'event_ticket' THEN
    v_qty := GREATEST(COALESCE((NEW.metadata->>'quantity')::int, 1), 1);
    v_name := COALESCE(NULLIF(NEW.metadata->>'buyer_name', ''), '¡Genial!');

    SELECT * INTO v_event FROM public.events WHERE id = (NEW.metadata->>'event_id')::uuid;

    IF v_event.id IS NOT NULL THEN
      PERFORM public.enqueue_notification_from_template(
        NEW.user_id,
        'attendee',
        'purchase_completed',
        jsonb_build_object(
          'name', v_name,
          'event_title', v_event.title,
          'quantity', v_qty::text,
          'event_id', v_event.id::text,
          'payment_intent_id', NEW.stripe_payment_intent_id
        )
      );

      IF v_event.creator_id IS NOT NULL THEN
        IF NOT EXISTS (
          SELECT 1
          FROM public.notifications n
          WHERE n.user_id = v_event.creator_id
            AND n.type = 'organizer_realtime_sale'
            AND (n.data->>'payment_intent_id') = NEW.stripe_payment_intent_id
        ) THEN
          PERFORM public.enqueue_notification(
            v_event.creator_id,
            'organizer',
            'organizer_realtime_sale',
            '💰 Nueva venta',
            'Se vendieron ' || v_qty || ' entrada(s) para ' || v_event.title,
            'normal',
            jsonb_build_object('event_id', v_event.id::text, 'quantity', v_qty, 'payment_intent_id', NEW.stripe_payment_intent_id)
          );
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.suppress_duplicate_sale_alerts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_pi text;
  v_event_id text;
BEGIN
  IF NEW.role = 'organizer' AND NEW.type = 'sale_alert' THEN
    v_pi := NULLIF(COALESCE(NEW.data->>'payment_intent_id', ''), '');
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
    ELSIF v_event_id IS NOT NULL THEN
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

DROP TRIGGER IF EXISTS trg_suppress_duplicate_sale_alerts ON public.notifications;
CREATE TRIGGER trg_suppress_duplicate_sale_alerts
BEFORE INSERT ON public.notifications
FOR EACH ROW
EXECUTE FUNCTION public.suppress_duplicate_sale_alerts();

NOTIFY pgrst, 'reload schema';

