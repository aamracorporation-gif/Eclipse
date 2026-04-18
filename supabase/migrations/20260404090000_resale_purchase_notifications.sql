CREATE OR REPLACE FUNCTION public.handle_payment_fulfilled_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event public.events%ROWTYPE;
  v_qty int;
  v_name text;
  v_listing_id uuid;
  v_ticket_id uuid;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM 'fulfilled' OR OLD.status = 'fulfilled' THEN
    RETURN NEW;
  END IF;

  IF NEW.kind = 'event_ticket' THEN
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
        PERFORM public.enqueue_notification(
          v_event.creator_id,
          'organizer',
          'organizer_realtime_sale',
          '💰 Nueva venta',
          'Se vendieron ' || v_qty || ' entrada(s) para ' || v_event.title,
          'normal',
          jsonb_build_object('event_id', v_event.id, 'quantity', v_qty, 'payment_intent_id', NEW.stripe_payment_intent_id)
        );
      END IF;
    END IF;
  ELSIF NEW.kind = 'resale_ticket' THEN
    v_qty := 1;
    v_name := COALESCE(NULLIF(NEW.metadata->>'buyer_name', ''), '¡Genial!');
    v_listing_id := NULLIF(NEW.metadata->>'listing_id', '')::uuid;

    IF v_listing_id IS NOT NULL THEN
      SELECT rl.ticket_id INTO v_ticket_id
      FROM public.resale_listings rl
      WHERE rl.id = v_listing_id;

      IF v_ticket_id IS NOT NULL THEN
        SELECT e.* INTO v_event
        FROM public.tickets t
        JOIN public.events e ON e.id = t.event_id
        WHERE t.id = v_ticket_id;

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
              'payment_intent_id', NEW.stripe_payment_intent_id,
              'listing_id', v_listing_id::text,
              'ticket_id', v_ticket_id::text
            )
          );
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_fulfilled_notifications ON public.payment_transactions;
CREATE TRIGGER trg_payment_fulfilled_notifications
AFTER UPDATE ON public.payment_transactions
FOR EACH ROW
EXECUTE FUNCTION public.handle_payment_fulfilled_notifications();

NOTIFY pgrst, 'reload schema';
