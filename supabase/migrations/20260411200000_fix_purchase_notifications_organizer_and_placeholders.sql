-- 1) Ensure template renderer exists (prevents "{{event_title}}" from leaking to users)
CREATE OR REPLACE FUNCTION public.render_notification_template(p_template text, p_data jsonb)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_out text := COALESCE(p_template, '');
  kv record;
BEGIN
  IF p_data IS NULL THEN
    RETURN v_out;
  END IF;

  FOR kv IN SELECT key, value FROM jsonb_each_text(p_data) LOOP
    v_out := replace(v_out, '{{' || kv.key || '}}', kv.value);
  END LOOP;

  RETURN v_out;
END;
$$;

-- 2) Make enqueue_notification_from_template always render templates
CREATE OR REPLACE FUNCTION public.enqueue_notification_from_template(
  p_user_id uuid,
  p_role text,
  p_type text,
  p_data jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tpl public.notification_templates%ROWTYPE;
  v_title text;
  v_body text;
  v_existing uuid;
BEGIN
  SELECT * INTO v_tpl FROM public.notification_templates WHERE key = p_type AND enabled = true;

  IF v_tpl.key IS NULL THEN
    PERFORM public.enqueue_notification(p_user_id, p_role, p_type, 'Notificación', COALESCE(p_data->>'message', p_type), 'normal', p_data);
    RETURN;
  END IF;

  IF v_tpl.dedupe_seconds > 0 THEN
    SELECT n.id INTO v_existing
    FROM public.notifications n
    WHERE n.user_id = p_user_id
      AND n.type = p_type
      AND n.created_at > now() - make_interval(secs => v_tpl.dedupe_seconds)
    ORDER BY n.created_at DESC
    LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN;
    END IF;
  END IF;

  v_title := public.render_notification_template(v_tpl.title_template, p_data);
  v_body := public.render_notification_template(v_tpl.body_template, p_data);

  PERFORM public.enqueue_notification(p_user_id, p_role, p_type, v_title, v_body, v_tpl.default_priority, p_data);
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_notification_from_template(uuid, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_notification_from_template(uuid, text, text, jsonb) TO authenticated, service_role;

-- 3) Stop per-ticket "purchase_success / ticket_available" spam for primary purchases.
--    Primary purchase notifications must come from payment_transactions fulfillment (1 per payment intent).
CREATE OR REPLACE FUNCTION public.notify_ticket_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ticket_id uuid;
  v_event_id uuid;
  v_event_title text;
  v_event_date timestamptz;
  v_organizer_id uuid;
  v_venue_id uuid;
  v_venue_name text;
  v_venue_address text;

  v_new_owner uuid;
  v_old_owner uuid;

  v_buyer_id uuid;
  v_seller_id uuid;
  v_is_resale boolean := false;

  v_lock_key bigint;
  v_data jsonb;

  v_qr_token text;
  v_qr_code text;

  v_rt record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  v_ticket_id := NEW.id;
  v_event_id := NEW.event_id;

  v_new_owner :=
    COALESCE(
      NULLIF(to_jsonb(NEW)->>'owner_id', '')::uuid,
      NULLIF(to_jsonb(NEW)->>'user_id', '')::uuid
    );

  v_old_owner :=
    COALESCE(
      NULLIF(to_jsonb(OLD)->>'owner_id', '')::uuid,
      NULLIF(to_jsonb(OLD)->>'user_id', '')::uuid
    );

  IF v_old_owner IS NOT DISTINCT FROM v_new_owner THEN
    RETURN NEW;
  END IF;

  v_buyer_id := v_new_owner;
  v_seller_id := v_old_owner;
  v_is_resale := true;

  SELECT e.title, e.creator_id, e.event_date, e.venue_id
  INTO v_event_title, v_organizer_id, v_event_date, v_venue_id
  FROM public.events e
  WHERE e.id = v_event_id;

  IF v_venue_id IS NOT NULL THEN
    SELECT v.name, v.address INTO v_venue_name, v_venue_address
    FROM public.venues v
    WHERE v.id = v_venue_id;
  END IF;

  v_event_title := COALESCE(NULLIF(v_event_title, ''), 'este evento');

  v_qr_token := COALESCE(NULLIF(to_jsonb(NEW)->>'qr_token', ''), NULLIF(to_jsonb(NEW)->>'qr_code', ''), '');
  v_qr_code := COALESCE(NULLIF(to_jsonb(NEW)->>'qr_code', ''), '');

  v_lock_key :=
    hashtext(
      'notify_ticket_sale:' ||
      COALESCE(v_ticket_id::text, '') || ':' ||
      COALESCE(v_buyer_id::text, '') || ':' ||
      COALESCE(v_seller_id::text, '') || ':resale'
    )::bigint;

  IF NOT pg_try_advisory_xact_lock(v_lock_key) THEN
    RETURN NEW;
  END IF;

  v_data := jsonb_build_object(
    'event_id', v_event_id::text,
    'event_title', v_event_title,
    'event_date', COALESCE(v_event_date::text, ''),
    'venue_name', COALESCE(v_venue_name, ''),
    'venue_address', COALESCE(v_venue_address, ''),
    'ticket_id', v_ticket_id::text,
    'qr_token', v_qr_token,
    'qr_code', v_qr_code,
    'buyer_id', COALESCE(v_buyer_id::text, ''),
    'seller_id', COALESCE(v_seller_id::text, ''),
    'source', 'resale'
  );

  BEGIN
    SELECT *
    INTO v_rt
    FROM public.resale_transactions rt
    WHERE rt.ticket_id = v_ticket_id
    ORDER BY rt.created_at DESC
    LIMIT 1;

    v_data := v_data || jsonb_build_object(
      'resale_transaction_id', COALESCE(to_jsonb(v_rt)->>'id', NULL),
      'amount', COALESCE(to_jsonb(v_rt)->>'price', NULL),
      'commission', COALESCE(to_jsonb(v_rt)->>'commission', NULL),
      'seller_amount', COALESCE(to_jsonb(v_rt)->>'seller_amount', NULL),
      'payment_method', 'resale'
    );
  EXCEPTION WHEN others THEN
    NULL;
  END;

  IF v_organizer_id IS NOT NULL THEN
    PERFORM public.enqueue_notification_from_template(
      v_organizer_id,
      'organizer',
      'organizer_realtime_sale',
      v_data
    );
  END IF;

  IF v_buyer_id IS NOT NULL THEN
    PERFORM public.enqueue_notification_from_template(
      v_buyer_id,
      'attendee',
      'purchase_success',
      v_data
    );

    PERFORM public.enqueue_notification_from_template(
      v_buyer_id,
      'attendee',
      'ticket_available',
      v_data
    );
  END IF;

  IF v_seller_id IS NOT NULL AND v_seller_id IS DISTINCT FROM v_buyer_id THEN
    PERFORM public.enqueue_notification_from_template(
      v_seller_id,
      'attendee',
      'resale_sold',
      v_data
    );
  END IF;

  RETURN NEW;
END;
$$;

-- 4) Re-add organizer notifications for normal ticket purchases on payment fulfillment (1 per purchase).
CREATE OR REPLACE FUNCTION public.handle_payment_fulfilled_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event public.events%ROWTYPE;
  v_qty int;
  v_name text;
  v_listing public.resale_listings%ROWTYPE;
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

DROP TRIGGER IF EXISTS trg_payment_fulfilled_notifications ON public.payment_transactions;
CREATE TRIGGER trg_payment_fulfilled_notifications
AFTER UPDATE ON public.payment_transactions
FOR EACH ROW
EXECUTE FUNCTION public.handle_payment_fulfilled_notifications();

NOTIFY pgrst, 'reload schema';

