-- ==============================================================================
-- SCRIPT: FIX PRIMARY PURCHASE CARD DUPLICATE RESALE
-- Removes the resale logic from handle_payment_fulfilled_notifications because
-- notify_ticket_sale already handles ALL resale notifications correctly.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.handle_payment_fulfilled_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event public.events%ROWTYPE;
  v_qty int;
  v_name text;
  v_data jsonb;
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
      v_data := jsonb_build_object(
        'name', v_name,
        'event_title', COALESCE(v_event.title, ''),
        'quantity', v_qty::text,
        'event_id', v_event.id::text,
        'payment_intent_id', NEW.stripe_payment_intent_id
      );

      PERFORM public.enqueue_notification_from_template(
        NEW.user_id,
        'attendee',
        'purchase_completed',
        v_data
      );

      IF v_event.creator_id IS NOT NULL THEN
        PERFORM public.enqueue_notification_from_template(
          v_event.creator_id,
          'organizer',
          'organizer_realtime_sale',
          v_data
        );
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';