-- ================================================================
-- NOTIFICATION SYSTEM — COMPLETE DEFINITIVE FIX
-- Fixes:
--   1. Resale: seller gets notification, NOT organizer
--   2. Eclipse credit (wallet): trigger on INSERT OR UPDATE
--   3. All other triggers recreated clean with no conflicts
--   4. push_notify with sane dedup values per type
-- ================================================================

-- ── 0. DROP ALL notification-generating triggers (clean slate) ───
DROP TRIGGER IF EXISTS trg_payment_fulfilled              ON public.payment_transactions;
DROP TRIGGER IF EXISTS trg_ticket_created                ON public.tickets;
DROP TRIGGER IF EXISTS trg_ticket_validated              ON public.tickets;
DROP TRIGGER IF EXISTS trg_event_update                  ON public.events;
DROP TRIGGER IF EXISTS trg_event_published               ON public.events;
DROP TRIGGER IF EXISTS trg_organizer_verification        ON public.profiles;
DROP TRIGGER IF EXISTS on_event_update                   ON public.events;
DROP TRIGGER IF EXISTS on_payment_fulfilled              ON public.payment_transactions;
DROP TRIGGER IF EXISTS on_ticket_created                 ON public.tickets;
DROP TRIGGER IF EXISTS on_ticket_validated               ON public.tickets;
DROP TRIGGER IF EXISTS trg_notify_attendees_event_modified ON public.events;

-- ── 1. push_notify — single clean entry point ────────────────────
CREATE OR REPLACE FUNCTION public.push_notify(
  p_user_id     uuid,
  p_type        text,
  p_title       text,
  p_body        text,
  p_data        jsonb DEFAULT '{}'::jsonb,
  p_dedupe_secs int   DEFAULT 300
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_id uuid;
BEGIN
  IF p_user_id IS NULL OR COALESCE(p_title,'') = '' THEN RETURN NULL; END IF;

  IF p_dedupe_secs > 0 AND EXISTS (
    SELECT 1 FROM public.notifications
    WHERE user_id = p_user_id AND type = p_type
      AND created_at > now() - make_interval(secs => p_dedupe_secs)
    LIMIT 1
  ) THEN RETURN NULL; END IF;

  IF (SELECT count(*) FROM public.notifications
      WHERE user_id = p_user_id AND created_at > now() - interval '1 minute') >= 10
  THEN RETURN NULL; END IF;

  INSERT INTO public.notifications
    (user_id, type, title, body, data, priority, status, channels, role, read)
  VALUES
    (p_user_id, p_type, p_title, COALESCE(p_body,''), COALESCE(p_data,'{}'),
     'high', 'pending', ARRAY['in_app','push']::text[], 'attendee', false)
  RETURNING id INTO v_id;

  RETURN v_id;
EXCEPTION WHEN others THEN RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.push_notify(uuid,text,text,text,jsonb,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.push_notify(uuid,text,text,text,jsonb,int) TO service_role;

-- ── 2. TRIGGER A: payment_transactions → card purchases ──────────
-- Buyer: purchase_confirmed
-- Seller (resale only): resale_sold
-- Organizer: new_sale ONLY for primary ticket (NOT resale)
CREATE OR REPLACE FUNCTION public.on_payment_fulfilled()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_event   public.events%ROWTYPE;
  v_listing public.resale_listings%ROWTYPE;
  v_ticket  public.tickets%ROWTYPE;
  v_qty     int;
  v_etitle  text;
  v_data    jsonb;
BEGIN
  IF TG_OP <> 'UPDATE'
     OR NEW.status IS NOT DISTINCT FROM OLD.status
     OR NEW.status <> 'fulfilled' THEN
    RETURN NEW;
  END IF;

  v_qty := GREATEST(COALESCE((NEW.metadata->>'quantity')::int, 1), 1);

  -- ── Primary ticket purchase (card) ───────────────────────────
  IF NEW.kind IN ('event_ticket', 'vip_table') THEN
    SELECT * INTO v_event FROM public.events
    WHERE id = NULLIF(NEW.metadata->>'event_id','')::uuid;
    IF v_event.id IS NULL THEN RETURN NEW; END IF;

    v_etitle := COALESCE(NULLIF(v_event.title,''), 'tu evento');
    v_data := jsonb_build_object(
      'type','purchase_confirmed',
      'event_id', v_event.id::text, 'eventId', v_event.id::text,
      'event_title', v_etitle, 'quantity', v_qty::text
    );

    -- Buyer
    PERFORM public.push_notify(
      NEW.user_id, 'purchase_confirmed',
      '🎟️ ¡Compra confirmada!',
      CASE WHEN v_qty = 1
        THEN 'Tu entrada para "' || v_etitle || '" está lista. Ve a Mis Entradas para ver el QR.'
        ELSE v_qty::text || ' entradas para "' || v_etitle || '" están listas. Ve a Mis Entradas.'
      END,
      v_data, 43200
    );

    -- Organizer (only for primary sales, not resale)
    IF v_event.creator_id IS NOT NULL
       AND v_event.creator_id IS DISTINCT FROM NEW.user_id THEN
      PERFORM public.push_notify(
        v_event.creator_id, 'organizer_new_sale',
        '💰 Nueva venta',
        CASE WHEN v_qty = 1
          THEN 'Vendiste 1 entrada de "' || v_etitle || '".'
          ELSE 'Vendiste ' || v_qty::text || ' entradas de "' || v_etitle || '".'
        END,
        v_data || '{"type":"organizer_new_sale"}'::jsonb, 60
      );
    END IF;

  -- ── Resale purchase (card) ────────────────────────────────────
  -- Buyer: gets purchase confirmed
  -- Seller (who listed the ticket): gets resale_sold
  -- Organizer: does NOT get notified for resale transactions
  ELSIF NEW.kind = 'resale_ticket' THEN
    -- Find the listing
    SELECT * INTO v_listing FROM public.resale_listings
    WHERE id = NULLIF(NEW.metadata->>'listing_id','')::uuid;
    IF v_listing.id IS NULL THEN
      SELECT rl.* INTO v_listing FROM public.resale_listings rl
      JOIN public.tickets tk ON tk.id = rl.ticket_id
      WHERE tk.id = NULLIF(NEW.metadata->>'ticket_id','')::uuid LIMIT 1;
    END IF;
    IF v_listing.id IS NOT NULL THEN
      SELECT * INTO v_ticket FROM public.tickets WHERE id = v_listing.ticket_id;
      SELECT * INTO v_event  FROM public.events  WHERE id = v_ticket.event_id;
    END IF;

    v_etitle := COALESCE(NULLIF(v_event.title,''), 'tu evento');
    v_data := jsonb_build_object(
      'type','resale_purchased',
      'event_id', COALESCE(v_event.id::text,''), 'eventId', COALESCE(v_event.id::text,''),
      'event_title', v_etitle
    );

    -- Buyer
    PERFORM public.push_notify(
      NEW.user_id, 'resale_purchased',
      '🎟️ ¡Reventa confirmada!',
      'Tu entrada de reventa para "' || v_etitle || '" está lista. Ve a Mis Entradas.',
      v_data, 43200
    );

    -- Seller (the person who listed the ticket for resale)
    IF v_listing.seller_id IS NOT NULL
       AND v_listing.seller_id IS DISTINCT FROM NEW.user_id THEN
      PERFORM public.push_notify(
        v_listing.seller_id, 'resale_sold',
        '💸 ¡Entrada vendida!',
        'Vendiste tu entrada de "' || v_etitle || '" en reventa. El pago está en camino.',
        v_data || '{"type":"resale_sold"}'::jsonb, 43200
      );
    END IF;

    -- NOTE: Organizer intentionally NOT notified for resale transactions.
  END IF;

  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END;
$$;

CREATE TRIGGER trg_payment_fulfilled
AFTER UPDATE ON public.payment_transactions
FOR EACH ROW EXECUTE FUNCTION public.on_payment_fulfilled();

-- ── 3. TRIGGER B: tickets → wallet/worker purchases ──────────────
-- Fires on INSERT (wallet creates ticket directly as valid)
-- AND on UPDATE (wallet creates as pending → updates to valid)
-- 43200s dedup prevents double-fire when card+ticket both trigger
CREATE OR REPLACE FUNCTION public.on_ticket_created()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_event  public.events%ROWTYPE;
  v_etitle text;
  v_data   jsonb;
BEGIN
  IF NEW.user_id IS NULL THEN RETURN NEW; END IF;

  -- Only care about valid/active tickets
  IF COALESCE(NEW.status,'') NOT IN ('valid','active') THEN RETURN NEW; END IF;

  -- On UPDATE: skip if ticket was already valid (avoid re-triggering)
  IF TG_OP = 'UPDATE' THEN
    IF COALESCE(OLD.status,'') IN ('valid','active') THEN RETURN NEW; END IF;
  END IF;

  -- Skip resale tickets — handled by on_payment_fulfilled
  IF COALESCE(NEW.is_resale, false) = true THEN RETURN NEW; END IF;

  SELECT * INTO v_event FROM public.events WHERE id = NEW.event_id;
  v_etitle := COALESCE(NULLIF(v_event.title,''), 'tu evento');

  v_data := jsonb_build_object(
    'type','purchase_confirmed',
    'event_id', COALESCE(NEW.event_id::text,''), 'eventId', COALESCE(NEW.event_id::text,''),
    'event_title', v_etitle, 'ticket_id', NEW.id::text
  );

  -- Buyer
  PERFORM public.push_notify(
    NEW.user_id, 'purchase_confirmed',
    '🎟️ ¡Compra confirmada!',
    'Tu entrada para "' || v_etitle || '" está lista. Ve a Mis Entradas para ver el QR.',
    v_data, 43200
  );

  -- Organizer
  IF v_event.creator_id IS NOT NULL
     AND v_event.creator_id IS DISTINCT FROM NEW.user_id THEN
    PERFORM public.push_notify(
      v_event.creator_id, 'organizer_new_sale',
      '💰 Nueva venta',
      'Se vendió 1 entrada de "' || v_etitle || '".',
      v_data || '{"type":"organizer_new_sale"}'::jsonb, 60
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ticket_created
AFTER INSERT OR UPDATE ON public.tickets
FOR EACH ROW EXECUTE FUNCTION public.on_ticket_created();

-- ── 4. TRIGGER C: tickets UPDATE → QR validated ──────────────────
CREATE OR REPLACE FUNCTION public.on_ticket_validated()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_event  public.events%ROWTYPE;
  v_etitle text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.status <> 'used' THEN RETURN NEW; END IF;
  IF NEW.user_id IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO v_event FROM public.events WHERE id = NEW.event_id;
  v_etitle := COALESCE(NULLIF(v_event.title,''), 'tu evento');

  PERFORM public.push_notify(
    NEW.user_id, 'ticket_validated',
    '✅ ¡Entrada validada!',
    'Tu entrada para "' || v_etitle || '" fue escaneada. ¡Disfruta la noche!',
    jsonb_build_object(
      'type','ticket_validated',
      'event_id', COALESCE(NEW.event_id::text,''), 'eventId', COALESCE(NEW.event_id::text,''),
      'event_title', v_etitle, 'ticket_id', NEW.id::text
    ),
    10  -- 10s dedup only (same QR shouldn't be scanned twice anyway)
  );

  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ticket_validated
AFTER UPDATE ON public.tickets
FOR EACH ROW EXECUTE FUNCTION public.on_ticket_validated();

-- ── 5. TRIGGER D: events UPDATE → organizer changes ──────────────
-- ONLY fires for: cancelled / date changed / venue changed
-- Ignores: counter updates, sold_tickets, available_tickets, etc.
CREATE OR REPLACE FUNCTION public.on_event_updated()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  r        record;
  v_etitle text;
  v_type   text;
  v_title  text;
  v_body   text;
  v_data   jsonb;
BEGIN
  -- Ignore purely counter / metadata changes
  IF NEW.event_date   IS NOT DISTINCT FROM OLD.event_date
     AND NEW.venue_id IS NOT DISTINCT FROM OLD.venue_id
     AND COALESCE(NEW.status,'') NOT ILIKE 'cancel%'
  THEN RETURN NEW; END IF;

  -- Determine change type
  IF COALESCE(NEW.status,'') ILIKE 'cancel%'
     AND COALESCE(OLD.status,'') NOT ILIKE 'cancel%' THEN
    v_type  := 'event_cancelled';    v_title := '❌ Evento cancelado';
  ELSIF NEW.event_date IS DISTINCT FROM OLD.event_date THEN
    v_type  := 'event_date_changed'; v_title := '⏰ Cambio de fecha';
  ELSIF NEW.venue_id IS DISTINCT FROM OLD.venue_id THEN
    v_type  := 'event_venue_changed'; v_title := '📍 Cambio de lugar';
  ELSE
    RETURN NEW;
  END IF;

  v_etitle := COALESCE(NULLIF(NEW.title,''), 'el evento');
  v_body := CASE v_type
    WHEN 'event_cancelled'     THEN '"' || v_etitle || '" ha sido cancelado. Recibirás info sobre el reembolso.'
    WHEN 'event_date_changed'  THEN '"' || v_etitle || '" cambió de fecha. Revisa los nuevos detalles antes de ir.'
    WHEN 'event_venue_changed' THEN '"' || v_etitle || '" cambió de lugar. Abre el mapa para ver el nuevo sitio.'
    ELSE ''
  END;
  v_data := jsonb_build_object(
    'type', v_type, 'event_id', NEW.id::text, 'eventId', NEW.id::text, 'event_title', v_etitle
  );

  FOR r IN
    SELECT DISTINCT t.user_id FROM public.tickets t
    WHERE t.event_id = NEW.id AND t.user_id IS NOT NULL
      AND COALESCE(t.status,'') IN ('valid','active')
  LOOP
    PERFORM public.push_notify(r.user_id, v_type, v_title, v_body, v_data, 0);
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END;
$$;

CREATE TRIGGER trg_event_update
AFTER UPDATE ON public.events
FOR EACH ROW EXECUTE FUNCTION public.on_event_updated();

-- ── 6. TRIGGER E: profiles UPDATE → organizer verification ───────
CREATE OR REPLACE FUNCTION public.on_organizer_verification_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.verification_status IS NOT DISTINCT FROM OLD.verification_status THEN RETURN NEW; END IF;

  IF NEW.verification_status = 'verified' THEN
    PERFORM public.push_notify(
      NEW.id, 'organizer_verified',
      '✅ ¡Perfil verificado!',
      'Tu perfil de organizador ha sido verificado. Ya puedes publicar eventos públicos.',
      '{"type":"organizer_verified"}'::jsonb, 0
    );
  ELSIF NEW.verification_status IN ('rejected','needs_correction') THEN
    PERFORM public.push_notify(
      NEW.id, 'organizer_rejected',
      '❗ Verificación rechazada',
      'Tu perfil necesita correcciones: ' ||
        COALESCE(NULLIF(NEW.verification_rejection_reason,''), 'revisa tu información') ||
        '. Actualízalo e inténtalo de nuevo.',
      jsonb_build_object('type','organizer_rejected',
        'reason', COALESCE(NEW.verification_rejection_reason,'')), 0
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END;
$$;

CREATE TRIGGER trg_organizer_verification
AFTER UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.on_organizer_verification_changed();

-- ── 7. Cron: recordatorios 24h y 1h antes del evento ─────────────
CREATE OR REPLACE FUNCTION public.schedule_event_notifications()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE r record;
BEGIN
  -- 24h reminder
  FOR r IN
    SELECT DISTINCT COALESCE(t.user_id, p.id) AS uid,
           e.id AS eid, COALESCE(e.title,'Tu evento') AS etitle
    FROM public.tickets t
    JOIN public.events e ON e.id = t.event_id
    LEFT JOIN public.profiles p
      ON t.user_id IS NULL AND lower(p.email) = lower(t.buyer_email)
    WHERE (t.user_id IS NOT NULL OR p.id IS NOT NULL)
      AND COALESCE(t.status,'') IN ('valid','active')
      AND e.event_date BETWEEN (now() + interval '23 hours') AND (now() + interval '25 hours')
  LOOP
    PERFORM public.push_notify(
      r.uid, 'event_reminder_24h', '🌙 Tu evento es mañana',
      '"' || r.etitle || '" es mañana. Ten el QR listo y revisa cómo llegar.',
      jsonb_build_object('type','event_reminder_24h','event_id',r.eid::text,'eventId',r.eid::text,'event_title',r.etitle),
      3600
    );
  END LOOP;

  -- 1h reminder
  FOR r IN
    SELECT DISTINCT COALESCE(t.user_id, p.id) AS uid,
           e.id AS eid, COALESCE(e.title,'Tu evento') AS etitle
    FROM public.tickets t
    JOIN public.events e ON e.id = t.event_id
    LEFT JOIN public.profiles p
      ON t.user_id IS NULL AND lower(p.email) = lower(t.buyer_email)
    WHERE (t.user_id IS NOT NULL OR p.id IS NOT NULL)
      AND COALESCE(t.status,'') IN ('valid','active')
      AND e.event_date BETWEEN (now() + interval '45 minutes') AND (now() + interval '75 minutes')
  LOOP
    PERFORM public.push_notify(
      r.uid, 'event_reminder_1h', '⏰ ¡Tu evento empieza en 1 hora!',
      '"' || r.etitle || '" empieza en 1 hora. ¡Sal ya!',
      jsonb_build_object('type','event_reminder_1h','event_id',r.eid::text,'eventId',r.eid::text,'event_title',r.etitle),
      1800
    );
  END LOOP;
END;
$$;

-- Re-schedule cron (replace existing)
SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname IN (
  'schedule-event-notifications', 'notify-low-stock', 'notify-organizer-weekly-recap'
);

SELECT cron.schedule('schedule-event-notifications', '*/15 * * * *',
  'SELECT public.schedule_event_notifications();');
SELECT cron.schedule('notify-low-stock', '*/15 * * * *',
  'SELECT public.notify_low_stock();');
SELECT cron.schedule('notify-organizer-weekly-recap', '0 18 * * 0',
  'SELECT public.notify_organizer_weekly_recap();');

NOTIFY pgrst, 'reload schema';
