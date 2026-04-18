-- Global notifications system (Cliente + Organizador)
-- Single source of truth: payment_transactions status transition to fulfilled

-- 1) Templates (requested business names + coherent copy)
INSERT INTO public.notification_templates (key, title_template, body_template, default_priority, default_channels, dedupe_seconds, enabled)
VALUES
  ('PURCHASE_SUCCESS', '🎟️ Compra realizada con éxito', 'Tu entrada para "{{event_title}}" está confirmada. La noche te espera.', 'high', ARRAY['in_app','push']::text[], 0, true),
  ('RESALE_SUCCESS', '💰 Reventa completada', 'Tu entrada para "{{event_title}}" se ha vendido correctamente.', 'high', ARRAY['in_app','push']::text[], 0, true),
  ('NEW_SALE', '💸 Nueva entrada vendida', 'Nueva entrada vendida para "{{event_title}}".', 'normal', ARRAY['in_app','push','email']::text[], 0, true),
  ('EVENT_REMINDER_24H', '🌙 Mañana es tu noche', 'Mañana es "{{event_title}}". Tu noche está a punto de empezar.', 'high', ARRAY['in_app','push']::text[], 3600, true),
  ('EVENT_REMINDER_3H', '⏳ La noche se acerca', 'Faltan pocas horas para "{{event_title}}". Ve preparándote.', 'high', ARRAY['in_app','push']::text[], 1800, true),
  ('EVENT_REMINDER_30MIN', '🚪 Es tu momento', 'Las puertas de "{{event_title}}" se abren en breve. Es tu momento.', 'high', ARRAY['in_app','push']::text[], 1800, true),
  ('EVENT_TODAY', '🔥 Hoy es el día', 'Hoy es el día. Esta noche tienes "{{event_title}}".', 'high', ARRAY['in_app','push']::text[], 21600, true),
  ('EVENT_UPDATED', '⚠️ Cambios en tu evento', '"{{event_title}}" ha tenido cambios importantes. Revisa los detalles.', 'high', ARRAY['in_app','push']::text[], 300, true),
  ('EVENT_CANCELLED', '❌ Evento cancelado', '"{{event_title}}" ha sido cancelado. Recibirás información del reembolso.', 'high', ARRAY['in_app','push']::text[], 300, true),
  ('REFUND_SUCCESS', '💳 Reembolso completado', 'El reembolso de "{{event_title}}" se ha realizado correctamente.', 'high', ARRAY['in_app','push']::text[], 300, true),
  ('EVENT_POPULAR', '🔥 Evento en tendencia', '"{{event_title}}" está acumulando asistentes. La noche promete.', 'normal', ARRAY['in_app','push']::text[], 1800, true),
  ('EVENT_CANCELLED_CONFIRMATION', '✅ Cancelación registrada', 'Se ha registrado la cancelación de "{{event_title}}" y se notificará a asistentes.', 'normal', ARRAY['in_app','push']::text[], 300, true)
ON CONFLICT (key) DO UPDATE
SET
  title_template = EXCLUDED.title_template,
  body_template = EXCLUDED.body_template,
  default_priority = EXCLUDED.default_priority,
  default_channels = EXCLUDED.default_channels,
  dedupe_seconds = EXCLUDED.dedupe_seconds,
  enabled = EXCLUDED.enabled,
  updated_at = now();

-- Keep old keys aligned for app compatibility where needed
UPDATE public.notification_templates
SET dedupe_seconds = 0, updated_at = now()
WHERE key IN ('purchase_completed', 'resale_sold', 'organizer_realtime_sale');

-- 2) Strict dedupe + actor safety (prevents wrong actor receiving resale sold)
CREATE OR REPLACE FUNCTION public.suppress_duplicate_attendee_purchase_resale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_pi text;
  v_ticket_id text;
  v_listing_id text;
  v_seller_id text;
  v_buyer_id text;
BEGIN
  IF NEW.role IS DISTINCT FROM 'attendee' THEN
    RETURN NEW;
  END IF;

  IF NEW.type NOT IN ('purchase_completed', 'resale_sold', 'PURCHASE_SUCCESS', 'RESALE_SUCCESS') THEN
    RETURN NEW;
  END IF;

  v_pi := NULLIF(COALESCE(NEW.data->>'payment_intent_id', ''), '');
  v_ticket_id := NULLIF(COALESCE(NEW.data->>'ticket_id', ''), '');
  v_listing_id := NULLIF(COALESCE(NEW.data->>'listing_id', ''), '');
  v_seller_id := NULLIF(COALESCE(NEW.data->>'seller_id', ''), '');
  v_buyer_id := NULLIF(COALESCE(NEW.data->>'buyer_id', ''), '');

  -- Safety: resale success only for seller
  IF NEW.type IN ('resale_sold', 'RESALE_SUCCESS') AND v_seller_id IS NOT NULL AND NEW.user_id::text IS DISTINCT FROM v_seller_id THEN
    RETURN NULL;
  END IF;

  -- Safety: purchase success only for buyer (when provided)
  IF NEW.type IN ('purchase_completed', 'PURCHASE_SUCCESS') AND v_buyer_id IS NOT NULL AND NEW.user_id::text IS DISTINCT FROM v_buyer_id THEN
    RETURN NULL;
  END IF;

  -- strict dedupe
  IF v_pi IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.notifications n
    WHERE n.user_id = NEW.user_id
      AND n.type = NEW.type
      AND (n.data->>'payment_intent_id') = v_pi
  ) THEN
    RETURN NULL;
  END IF;

  IF v_listing_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.notifications n
    WHERE n.user_id = NEW.user_id
      AND n.type = NEW.type
      AND (n.data->>'listing_id') = v_listing_id
  ) THEN
    RETURN NULL;
  END IF;

  IF v_ticket_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.notifications n
    WHERE n.user_id = NEW.user_id
      AND n.type = NEW.type
      AND (n.data->>'ticket_id') = v_ticket_id
  ) THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aaa_suppress_duplicate_attendee_purchase_resale ON public.notifications;
CREATE TRIGGER trg_aaa_suppress_duplicate_attendee_purchase_resale
BEFORE INSERT ON public.notifications
FOR EACH ROW
EXECUTE FUNCTION public.suppress_duplicate_attendee_purchase_resale();

-- 3) Central function requested by business rules
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
  v_event_id uuid;
  v_qty int := 1;
  v_data jsonb;
BEGIN
  SELECT * INTO v_tx
  FROM public.payment_transactions
  WHERE id = p_transaction_id;

  IF v_tx.id IS NULL OR v_tx.status IS DISTINCT FROM 'fulfilled' THEN
    RETURN;
  END IF;

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
      'payment_intent_id', COALESCE(v_tx.stripe_payment_intent_id, '')
    );

    PERFORM public.enqueue_notification_from_template(v_tx.user_id, 'attendee', 'PURCHASE_SUCCESS', v_data);
    PERFORM public.enqueue_notification_from_template(v_tx.user_id, 'attendee', 'purchase_completed', v_data);

    IF v_event.creator_id IS NOT NULL THEN
      PERFORM public.enqueue_notification_from_template(v_event.creator_id, 'organizer', 'NEW_SALE', v_data);
      PERFORM public.enqueue_notification_from_template(v_event.creator_id, 'organizer', 'organizer_realtime_sale', v_data);
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
      'payment_intent_id', COALESCE(v_tx.stripe_payment_intent_id, '')
    );

    -- Buyer (always purchase success)
    PERFORM public.enqueue_notification_from_template(v_tx.user_id, 'attendee', 'PURCHASE_SUCCESS', v_data);
    PERFORM public.enqueue_notification_from_template(v_tx.user_id, 'attendee', 'purchase_completed', v_data);

    -- Seller (only resale success)
    IF v_listing.seller_id IS NOT NULL AND v_listing.seller_id IS DISTINCT FROM v_tx.user_id THEN
      PERFORM public.enqueue_notification_from_template(v_listing.seller_id, 'attendee', 'RESALE_SUCCESS', v_data);
      PERFORM public.enqueue_notification_from_template(v_listing.seller_id, 'attendee', 'resale_sold', v_data);
    END IF;

    -- Organizer (new sale also on resale)
    IF v_event.creator_id IS NOT NULL THEN
      PERFORM public.enqueue_notification_from_template(v_event.creator_id, 'organizer', 'NEW_SALE', v_data);
      PERFORM public.enqueue_notification_from_template(v_event.creator_id, 'organizer', 'organizer_realtime_sale', v_data);
    END IF;
    RETURN;
  END IF;
END;
$$;

-- Trigger wrapper (single source based on final status)
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

  PERFORM public."triggerNotificationsOnTransactionComplete"(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_fulfilled_notifications ON public.payment_transactions;
CREATE TRIGGER trg_payment_fulfilled_notifications
AFTER UPDATE ON public.payment_transactions
FOR EACH ROW
EXECUTE FUNCTION public.handle_payment_fulfilled_notifications();

-- Ensure resale notifications do not come from legacy ticket triggers
DROP TRIGGER IF EXISTS trigger_notify_ticket_sale ON public.tickets;

-- 4) Wrappers for scheduled/business functions with requested names
CREATE OR REPLACE FUNCTION public."triggerEventReminders"()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Existing scheduler function in project
  PERFORM public.schedule_event_notifications();
END;
$$;

CREATE OR REPLACE FUNCTION public."triggerEventUpdates"(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  e public.events%ROWTYPE;
  r record;
  v_data jsonb;
BEGIN
  SELECT * INTO e FROM public.events WHERE id = p_event_id;
  IF e.id IS NULL THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT DISTINCT t.user_id
    FROM public.tickets t
    WHERE t.event_id = e.id
      AND t.user_id IS NOT NULL
      AND t.status = 'valid'
  LOOP
    v_data := jsonb_build_object('event_id', e.id::text, 'event_title', COALESCE(e.title, ''));
    PERFORM public.enqueue_notification_from_template(r.user_id, 'attendee', 'EVENT_UPDATED', v_data);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public."triggerRecommendations"()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM public.schedule_event_recommendations();
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_refund_success(p_user_id uuid, p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_title text;
BEGIN
  SELECT title INTO v_title FROM public.events WHERE id = p_event_id;
  PERFORM public.enqueue_notification_from_template(
    p_user_id,
    'attendee',
    'REFUND_SUCCESS',
    jsonb_build_object('event_id', p_event_id::text, 'event_title', COALESCE(v_title, 'este evento'))
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
