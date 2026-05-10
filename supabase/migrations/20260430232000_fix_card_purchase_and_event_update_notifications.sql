CREATE OR REPLACE FUNCTION public."triggerNotificationsOnTransactionComplete"(p_transaction_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tx public.payment_transactions%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_listing public.resale_listings%ROWTYPE;
  v_ticket public.tickets%ROWTYPE;
  v_rt public.resale_transactions%ROWTYPE;
  v_vip public.reservados_vip%ROWTYPE;
  v_event_id uuid;
  v_qty int := 1;
  v_data jsonb;
  v_pi text;
BEGIN
  SELECT * INTO v_tx
  FROM public.payment_transactions
  WHERE id = p_transaction_id;

  IF v_tx.id IS NULL OR v_tx.status IS DISTINCT FROM 'fulfilled' THEN
    RETURN;
  END IF;

  v_pi := NULLIF(COALESCE(v_tx.stripe_payment_intent_id, ''), '');

  IF v_tx.kind = 'event_ticket' THEN
    v_event_id := NULLIF(v_tx.metadata->>'event_id', '')::uuid;
    v_qty := GREATEST(COALESCE((v_tx.metadata->>'quantity')::int, 1), 1);

    SELECT * INTO v_event
    FROM public.events
    WHERE id = v_event_id;

    IF v_event.id IS NULL THEN
      RETURN;
    END IF;

    v_data := jsonb_build_object(
      'buyer_id', COALESCE(v_tx.user_id::text, ''),
      'event_id', v_event.id::text,
      'event_title', COALESCE(v_event.title, ''),
      'quantity', v_qty::text,
      'payment_intent_id', COALESCE(v_pi, '')
    );

    BEGIN
      PERFORM public.enqueue_notification_from_template(v_tx.user_id, 'attendee', 'purchase_completed', v_data);
    EXCEPTION WHEN others THEN
      NULL;
    END;

    IF v_event.creator_id IS NOT NULL THEN
      BEGIN
        PERFORM public.enqueue_notification_from_template(v_event.creator_id, 'organizer', 'organizer_realtime_sale', v_data);
      EXCEPTION WHEN others THEN
        NULL;
      END;
    END IF;
    RETURN;
  END IF;

  IF v_tx.kind = 'vip_table' THEN
    SELECT * INTO v_vip
    FROM public.reservados_vip
    WHERE id = NULLIF(v_tx.metadata->>'vip_reservado_id', '')::uuid;

    IF v_vip.id IS NULL THEN
      v_event_id := NULLIF(v_tx.metadata->>'event_id', '')::uuid;
    ELSE
      v_event_id := v_vip.event_id;
    END IF;

    IF v_event_id IS NULL THEN
      RETURN;
    END IF;

    SELECT * INTO v_event
    FROM public.events
    WHERE id = v_event_id;

    IF v_event.id IS NULL THEN
      RETURN;
    END IF;

    v_data := jsonb_build_object(
      'buyer_id', COALESCE(v_tx.user_id::text, ''),
      'event_id', v_event.id::text,
      'event_title', COALESCE(v_event.title, ''),
      'quantity', '1',
      'payment_intent_id', COALESCE(v_pi, ''),
      'kind', 'vip_table'
    );

    BEGIN
      PERFORM public.enqueue_notification_from_template(v_tx.user_id, 'attendee', 'purchase_completed', v_data);
    EXCEPTION WHEN others THEN
      NULL;
    END;

    IF v_event.creator_id IS NOT NULL THEN
      BEGIN
        PERFORM public.enqueue_notification_from_template(v_event.creator_id, 'organizer', 'organizer_realtime_sale', v_data);
      EXCEPTION WHEN others THEN
        NULL;
      END;
    END IF;
    RETURN;
  END IF;

  IF v_tx.kind = 'resale_ticket' THEN
    SELECT * INTO v_listing
    FROM public.resale_listings
    WHERE id = NULLIF(v_tx.metadata->>'listing_id', '')::uuid;

    IF v_listing.id IS NULL THEN
      SELECT * INTO v_rt
      FROM public.resale_transactions
      WHERE payment_transaction_id = v_tx.id
         OR stripe_payment_intent_id = v_tx.stripe_payment_intent_id
      ORDER BY created_at DESC
      LIMIT 1;

      IF v_rt.id IS NOT NULL THEN
        SELECT * INTO v_listing FROM public.resale_listings WHERE id = v_rt.listing_id;
      END IF;
    END IF;

    IF v_listing.id IS NULL THEN
      RETURN;
    END IF;

    SELECT * INTO v_ticket
    FROM public.tickets
    WHERE id = v_listing.ticket_id;

    IF v_ticket.id IS NULL THEN
      RETURN;
    END IF;

    SELECT * INTO v_event
    FROM public.events
    WHERE id = v_ticket.event_id;

    IF v_event.id IS NULL THEN
      RETURN;
    END IF;

    v_data := jsonb_build_object(
      'buyer_id', COALESCE(v_tx.user_id::text, ''),
      'seller_id', COALESCE(v_listing.seller_id::text, ''),
      'event_id', v_event.id::text,
      'event_title', COALESCE(v_event.title, ''),
      'quantity', '1',
      'ticket_id', v_ticket.id::text,
      'listing_id', v_listing.id::text,
      'payment_intent_id', COALESCE(v_pi, '')
    );

    BEGIN
      PERFORM public.enqueue_notification_from_template(v_tx.user_id, 'attendee', 'purchase_completed', v_data);
    EXCEPTION WHEN others THEN
      NULL;
    END;

    IF v_listing.seller_id IS NOT NULL AND v_listing.seller_id IS DISTINCT FROM v_tx.user_id THEN
      BEGIN
        PERFORM public.enqueue_notification_from_template(v_listing.seller_id, 'attendee', 'resale_sold', v_data);
      EXCEPTION WHEN others THEN
        NULL;
      END;
    END IF;

    IF v_event.creator_id IS NOT NULL THEN
      BEGIN
        PERFORM public.enqueue_notification_from_template(v_event.creator_id, 'organizer', 'organizer_realtime_sale', v_data);
      EXCEPTION WHEN others THEN
        NULL;
      END;
    END IF;
    RETURN;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_payment_fulfilled_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM 'fulfilled' OR OLD.status = 'fulfilled' THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM public."triggerNotificationsOnTransactionComplete"(NEW.id);
  EXCEPTION WHEN others THEN
    NULL;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_fulfilled_notifications ON public.payment_transactions;
CREATE TRIGGER trg_payment_fulfilled_notifications
AFTER UPDATE ON public.payment_transactions
FOR EACH ROW
EXECUTE FUNCTION public.handle_payment_fulfilled_notifications();

NOTIFY pgrst, 'reload schema';
