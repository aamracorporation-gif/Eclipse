CREATE TABLE IF NOT EXISTS public.notification_templates (
  key text PRIMARY KEY,
  title_template text NOT NULL,
  body_template text NOT NULL,
  default_priority text DEFAULT 'normal',
  default_channels text[] DEFAULT ARRAY['in_app','push']::text[],
  dedupe_seconds integer DEFAULT 0,
  enabled boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

INSERT INTO public.notification_templates (key, title_template, body_template, default_priority, default_channels, dedupe_seconds, enabled)
VALUES
  ('purchase_success', '✅ Compra realizada correctamente', 'Tu compra para "{{event_title}}" se ha completado correctamente.', 'high', ARRAY['in_app','push','email','sms']::text[], 60, true),
  ('ticket_available', '📩 Entrada disponible en la app', 'Tu entrada para "{{event_title}}" ya está disponible en tu perfil.', 'normal', ARRAY['in_app','push','email','sms']::text[], 60, true),
  ('resale_sold', '💸 Entrada vendida', 'Has vendido tu entrada de "{{event_title}}".', 'high', ARRAY['in_app','push','email','sms']::text[], 60, true),
  ('organizer_realtime_sale', '💰 Nueva venta', 'Se ha vendido 1 entrada para "{{event_title}}".', 'normal', ARRAY['in_app','push','email']::text[], 60, true)
ON CONFLICT (key) DO UPDATE
SET
  title_template = EXCLUDED.title_template,
  body_template = EXCLUDED.body_template,
  default_priority = EXCLUDED.default_priority,
  default_channels = EXCLUDED.default_channels,
  dedupe_seconds = EXCLUDED.dedupe_seconds,
  enabled = EXCLUDED.enabled,
  updated_at = now();

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

  IF TG_OP = 'INSERT' THEN
    v_buyer_id := v_new_owner;
    v_seller_id := NULL;
    v_is_resale := false;
  ELSIF TG_OP = 'UPDATE' THEN
    IF v_old_owner IS NOT DISTINCT FROM v_new_owner THEN
      RETURN NEW;
    END IF;
    v_buyer_id := v_new_owner;
    v_seller_id := v_old_owner;
    v_is_resale := true;
  ELSE
    RETURN NEW;
  END IF;

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
      COALESCE(v_seller_id::text, '') || ':' ||
      CASE WHEN v_is_resale THEN 'resale' ELSE 'primary' END
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
    'source', CASE WHEN v_is_resale THEN 'resale' ELSE 'primary' END
  );

  IF v_is_resale THEN
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
  END IF;

  IF v_organizer_id IS NOT NULL THEN
    BEGIN
      PERFORM public.enqueue_notification_from_template(
        v_organizer_id,
        'organizer',
        'organizer_realtime_sale',
        v_data
      );
    EXCEPTION WHEN others THEN
      PERFORM public.enqueue_notification(
        v_organizer_id,
        'organizer',
        'organizer_realtime_sale',
        '💰 Nueva venta',
        'Se ha vendido 1 entrada para ' || v_event_title,
        'normal',
        v_data
      );
    END;
  END IF;

  IF v_buyer_id IS NOT NULL THEN
    BEGIN
      PERFORM public.enqueue_notification_from_template(
        v_buyer_id,
        'attendee',
        'purchase_success',
        v_data
      );
    EXCEPTION WHEN others THEN
      PERFORM public.enqueue_notification(
        v_buyer_id,
        'attendee',
        'purchase_success',
        '✅ Compra realizada correctamente',
        'Tu compra para ' || v_event_title || ' se ha completado correctamente.',
        'high',
        v_data
      );
    END;

    BEGIN
      PERFORM public.enqueue_notification_from_template(
        v_buyer_id,
        'attendee',
        'ticket_available',
        v_data
      );
    EXCEPTION WHEN others THEN
      PERFORM public.enqueue_notification(
        v_buyer_id,
        'attendee',
        'ticket_available',
        '📩 Entrada disponible en la app',
        'Tu entrada para ' || v_event_title || ' ya está disponible en tu perfil.',
        'normal',
        v_data
      );
    END;
  END IF;

  IF v_is_resale AND v_seller_id IS NOT NULL AND v_seller_id IS DISTINCT FROM v_buyer_id THEN
    BEGIN
      PERFORM public.enqueue_notification_from_template(
        v_seller_id,
        'attendee',
        'resale_sold',
        v_data
      );
    EXCEPTION WHEN others THEN
      PERFORM public.enqueue_notification(
        v_seller_id,
        'attendee',
        'resale_sold',
        '💸 Entrada vendida',
        'Has vendido tu entrada de ' || v_event_title || '.',
        'high',
        v_data
      );
    END;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_ticket_sale ON public.tickets;
CREATE TRIGGER trigger_notify_ticket_sale
AFTER INSERT OR UPDATE ON public.tickets
FOR EACH ROW
EXECUTE FUNCTION public.notify_ticket_sale();

NOTIFY pgrst, 'reload schema';
