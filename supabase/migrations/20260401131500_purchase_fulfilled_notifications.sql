-- Purchase fulfilled notification (single congratulation per payment intent)

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
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_fulfilled_notifications ON public.payment_transactions;
CREATE TRIGGER trg_payment_fulfilled_notifications
AFTER UPDATE ON public.payment_transactions
FOR EACH ROW
EXECUTE FUNCTION public.handle_payment_fulfilled_notifications();

-- Disable per-ticket purchase notifications to avoid spam (old trigger)
DROP TRIGGER IF EXISTS trg_ticket_insert_notifications ON public.tickets;

NOTIFY pgrst, 'reload schema';

