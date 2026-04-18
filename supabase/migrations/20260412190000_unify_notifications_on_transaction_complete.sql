CREATE OR REPLACE FUNCTION public.trigger_notifications_on_transaction_complete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_kind text;
  v_event public.events%ROWTYPE;
  v_qty int;
  v_name text;
  v_data jsonb;

  v_listing public.resale_listings%ROWTYPE;
  v_ticket public.tickets%ROWTYPE;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM 'fulfilled' OR OLD.status = 'fulfilled' THEN
    RETURN NEW;
  END IF;

  v_kind := NEW.kind;

  IF v_kind = 'event_ticket' THEN
    v_qty := GREATEST(COALESCE((NEW.metadata->>'quantity')::int, 1), 1);
    v_name := COALESCE(NULLIF(NEW.metadata->>'buyer_name', ''), '¡Genial!');

    SELECT * INTO v_event
    FROM public.events
    WHERE id = NULLIF(NEW.metadata->>'event_id', '')::uuid;

    IF v_event.id IS NULL THEN
      RETURN NEW;
    END IF;

    v_data := jsonb_build_object(
      'name', v_name,
      'event_id', v_event.id::text,
      'event_title', COALESCE(v_event.title, ''),
      'quantity', v_qty::text,
      'payment_intent_id', COALESCE(NEW.stripe_payment_intent_id, '')
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

    RETURN NEW;
  END IF;

  IF v_kind = 'resale_ticket' THEN
    SELECT * INTO v_listing
    FROM public.resale_listings
    WHERE id = NULLIF(NEW.metadata->>'listing_id', '')::uuid;

    IF v_listing.id IS NULL THEN
      RETURN NEW;
    END IF;

    SELECT * INTO v_ticket
    FROM public.tickets
    WHERE id = v_listing.ticket_id;

    IF v_ticket.id IS NULL THEN
      RETURN NEW;
    END IF;

    SELECT * INTO v_event
    FROM public.events
    WHERE id = v_ticket.event_id;

    IF v_event.id IS NULL THEN
      RETURN NEW;
    END IF;

    v_data := jsonb_build_object(
      'name', COALESCE(NULLIF(NEW.metadata->>'buyer_name', ''), '¡Genial!'),
      'event_id', v_event.id::text,
      'event_title', COALESCE(v_event.title, ''),
      'quantity', '1',
      'ticket_id', v_ticket.id::text,
      'listing_id', v_listing.id::text,
      'buyer_id', COALESCE(NEW.user_id::text, ''),
      'seller_id', COALESCE(v_listing.seller_id::text, ''),
      'payment_intent_id', COALESCE(NEW.stripe_payment_intent_id, '')
    );

    PERFORM public.enqueue_notification_from_template(
      NEW.user_id,
      'attendee',
      'purchase_completed',
      v_data
    );

    IF v_listing.seller_id IS NOT NULL AND v_listing.seller_id IS DISTINCT FROM NEW.user_id THEN
      PERFORM public.enqueue_notification_from_template(
        v_listing.seller_id,
        'attendee',
        'resale_sold',
        v_data
      );
    END IF;

    IF v_event.creator_id IS NOT NULL THEN
      PERFORM public.enqueue_notification_from_template(
        v_event.creator_id,
        'organizer',
        'organizer_realtime_sale',
        v_data
      );
    END IF;

    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_payment_fulfilled_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN public.trigger_notifications_on_transaction_complete();
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_fulfilled_notifications ON public.payment_transactions;
CREATE TRIGGER trg_payment_fulfilled_notifications
AFTER UPDATE ON public.payment_transactions
FOR EACH ROW
EXECUTE FUNCTION public.handle_payment_fulfilled_notifications();

DROP TRIGGER IF EXISTS trigger_notify_ticket_sale ON public.tickets;

CREATE OR REPLACE FUNCTION public.notify_ticket_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
