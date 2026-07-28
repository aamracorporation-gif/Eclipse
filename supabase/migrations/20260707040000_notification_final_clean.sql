-- ================================================================
-- NOTIFICATION SYSTEM — DEFINITIVE CLEAN REBUILD
-- Root cause found: on_event_updated() had a NULL boolean bug that
-- caused "event changed" notifications on EVERY events table update
-- (including counter decrements from purchases).
-- ================================================================

-- ── 0. CANCEL ALL PENDING DELIVERIES (clean slate) ──────────────
UPDATE public.notification_deliveries
SET status = 'failed', last_error = 'rebuild_v4'
WHERE status = 'pending';

-- ── 1. DROP ALL NOTIFICATION-GENERATING TRIGGERS ────────────────
DROP TRIGGER IF EXISTS trg_payment_fulfilled              ON public.payment_transactions;
DROP TRIGGER IF EXISTS trg_event_update                  ON public.events;
DROP TRIGGER IF EXISTS trg_ticket_created                ON public.tickets;
DROP TRIGGER IF EXISTS trg_ticket_validated              ON public.tickets;
DROP TRIGGER IF EXISTS trg_organizer_verification        ON public.profiles;
-- extra ones that might still exist
DROP TRIGGER IF EXISTS on_event_update                   ON public.events;
DROP TRIGGER IF EXISTS trg_notify_attendees_event_modified ON public.events;
DROP TRIGGER IF EXISTS trg_dispatch_notifications_after_event_update ON public.events;
DROP TRIGGER IF EXISTS trg_notify_ticket_changed         ON public.tickets;
DROP TRIGGER IF EXISTS trg_venue_update_notify_event_buyers ON public.venues;
DROP TRIGGER IF EXISTS trg_dispatch_notifications_after_venue_update ON public.venues;
DROP TRIGGER IF EXISTS trg_ledger_movimientos_notifications ON public.ledger_movimientos;
DROP TRIGGER IF EXISTS trg_payment_fulfilled_notifications ON public.payment_transactions;

-- ── 2. CORE FUNCTION: push_notify ────────────────────────────────
-- Single entry point for all notifications.
-- Inserts into notifications table; trg_create_notification_deliveries
-- then auto-creates the push delivery row.
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
DECLARE
  v_id uuid;
BEGIN
  IF p_user_id IS NULL OR COALESCE(p_title,'') = '' THEN
    RETURN NULL;
  END IF;

  -- Dedup: skip if same (user, type) notified within the window
  IF p_dedupe_secs > 0 AND EXISTS (
    SELECT 1 FROM public.notifications
    WHERE user_id   = p_user_id
      AND type      = p_type
      AND created_at > now() - make_interval(secs => p_dedupe_secs)
    LIMIT 1
  ) THEN
    RETURN NULL;
  END IF;

  -- Rate cap: max 10 per user per minute
  IF (
    SELECT count(*) FROM public.notifications
    WHERE user_id   = p_user_id
      AND created_at > now() - interval '1 minute'
  ) >= 10 THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.notifications
    (user_id, type, title, body, data, priority, status, channels, role, read)
  VALUES
    (p_user_id, p_type, p_title, COALESCE(p_body,''), COALESCE(p_data,'{}'),
     'high', 'pending', ARRAY['in_app','push']::text[], 'attendee', false)
  RETURNING id INTO v_id;

  RETURN v_id;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.push_notify(uuid,text,text,text,jsonb,int) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.push_notify(uuid,text,text,text,jsonb,int) TO service_role;

-- ── 3. TRIGGER A: payment_transactions → purchase (card) ─────────
CREATE OR REPLACE FUNCTION public.on_payment_fulfilled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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

  -- Card / wallet primary purchase
  IF NEW.kind IN ('event_ticket','vip_table') THEN
    SELECT * INTO v_event FROM public.events
    WHERE id = NULLIF(NEW.metadata->>'event_id','')::uuid;

    IF v_event.id IS NULL THEN RETURN NEW; END IF;
    v_etitle := COALESCE(NULLIF(v_event.title,''), 'tu evento');

    v_data := jsonb_build_object(
      'type','purchase_confirmed','event_id',v_event.id::text,
      'eventId',v_event.id::text,'event_title',v_etitle,'quantity',v_qty::text
    );

    -- Buyer
    PERFORM public.push_notify(
      NEW.user_id, 'purchase_confirmed',
      '🎟️ Compra confirmada',
      CASE WHEN v_qty=1
        THEN 'Tu entrada para "' || v_etitle || '" está lista. Ve a Mis Entradas para ver el QR.'
        ELSE v_qty::text || ' entradas para "' || v_etitle || '" están listas. Ve a Mis Entradas.'
      END,
      v_data, 43200
    );

    -- Organizer
    IF v_event.creator_id IS NOT NULL
       AND v_event.creator_id IS DISTINCT FROM NEW.user_id THEN
      PERFORM public.push_notify(
        v_event.creator_id, 'organizer_new_sale', '💰 Nueva venta',
        'Se vendió ' || v_qty::text || ' entrada(s) de "' || v_etitle || '".',
        v_data || '{"type":"organizer_new_sale"}'::jsonb, 60
      );
    END IF;

  -- Resale purchase via card
  ELSIF NEW.kind = 'resale_ticket' THEN
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
    v_data   := jsonb_build_object(
      'type','resale_purchased','event_id',COALESCE(v_event.id::text,''),
      'eventId',COALESCE(v_event.id::text,''),'event_title',v_etitle
    );

    PERFORM public.push_notify(
      NEW.user_id, 'resale_purchased', '🎟️ Reventa confirmada',
      'Tu entrada de reventa para "' || v_etitle || '" está lista. Ve a Mis Entradas.',
      v_data, 43200
    );

    IF v_listing.seller_id IS NOT NULL
       AND v_listing.seller_id IS DISTINCT FROM NEW.user_id THEN
      PERFORM public.push_notify(
        v_listing.seller_id, 'resale_sold', '💸 ¡Entrada vendida!',
        'Vendiste tu entrada para "' || v_etitle || '". El pago está en camino.',
        v_data || '{"type":"resale_sold"}'::jsonb, 43200
      );
    END IF;

    IF v_event.creator_id IS NOT NULL THEN
      PERFORM public.push_notify(
        v_event.creator_id, 'organizer_new_sale', '💰 Venta de reventa',
        'Se vendió una entrada de reventa de "' || v_etitle || '".',
        v_data || '{"type":"organizer_new_sale"}'::jsonb, 60
      );
    END IF;
  END IF;

  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END;
$$;

CREATE TRIGGER trg_payment_fulfilled
AFTER UPDATE ON public.payment_transactions
FOR EACH ROW EXECUTE FUNCTION public.on_payment_fulfilled();

-- ── 4. TRIGGER B: tickets INSERT → purchase (wallet / worker) ────
-- Wallet and worker-created purchases bypass payment_transactions.
-- 43200s dedup prevents double-notification when card purchase
-- also inserts a ticket (on_payment_fulfilled fires first).
CREATE OR REPLACE FUNCTION public.on_ticket_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event  public.events%ROWTYPE;
  v_etitle text;
  v_data   jsonb;
BEGIN
  IF NEW.user_id IS NULL THEN RETURN NEW; END IF;
  IF COALESCE(NEW.status,'') NOT IN ('valid','active') THEN RETURN NEW; END IF;

  SELECT * INTO v_event FROM public.events WHERE id = NEW.event_id;
  v_etitle := COALESCE(NULLIF(v_event.title,''), 'tu evento');

  v_data := jsonb_build_object(
    'type','purchase_confirmed','event_id',COALESCE(NEW.event_id::text,''),
    'eventId',COALESCE(NEW.event_id::text,''),'event_title',v_etitle,'ticket_id',NEW.id::text
  );

  PERFORM public.push_notify(
    NEW.user_id, 'purchase_confirmed', '🎟️ Compra confirmada',
    'Tu entrada para "' || v_etitle || '" está lista. Ve a Mis Entradas para ver el QR.',
    v_data, 43200
  );

  IF v_event.creator_id IS NOT NULL
     AND v_event.creator_id IS DISTINCT FROM NEW.user_id THEN
    PERFORM public.push_notify(
      v_event.creator_id, 'organizer_new_sale', '💰 Nueva venta',
      'Se vendió 1 entrada de "' || v_etitle || '".',
      v_data || '{"type":"organizer_new_sale"}'::jsonb, 60
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ticket_created
AFTER INSERT ON public.tickets
FOR EACH ROW EXECUTE FUNCTION public.on_ticket_created();

-- ── 5. TRIGGER C: events UPDATE → ONLY real organizer edits ──────
-- CRITICAL FIX: only fires when the organizer intentionally changes
-- the event date, venue, or cancels the event.
-- ANY other change (counters, updated_at, etc.) → NO notification.
CREATE OR REPLACE FUNCTION public.on_event_updated()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  r        record;
  v_etitle text;
  v_type   text;
  v_title  text;
  v_body   text;
  v_data   jsonb;
BEGIN
  -- ── Check what changed ───────────────────────────────────────
  -- We ONLY care about three real organizer actions:
  --   1. Event date/time changed
  --   2. Event venue changed
  --   3. Event cancelled

  -- Anything else (available_tickets, sold_tickets, updated_at,
  -- capacity, revenue counters, etc.) → silently ignore.

  IF NEW.event_date IS NOT DISTINCT FROM OLD.event_date
     AND NEW.venue_id IS NOT DISTINCT FROM OLD.venue_id
     AND COALESCE(NEW.status,'') NOT ILIKE 'cancel%'
  THEN
    RETURN NEW;   -- nothing meaningful changed → exit immediately
  END IF;

  -- If previously not cancelled and now cancelled → notify
  -- If date was same → not date-changed
  -- Pick the most important change type
  IF COALESCE(NEW.status,'') ILIKE 'cancel%'
     AND COALESCE(OLD.status,'') NOT ILIKE 'cancel%' THEN
    v_type  := 'event_cancelled';
    v_title := '❌ Evento cancelado';
  ELSIF NEW.event_date IS DISTINCT FROM OLD.event_date THEN
    v_type  := 'event_date_changed';
    v_title := '⏰ Cambio de fecha';
  ELSIF NEW.venue_id IS DISTINCT FROM OLD.venue_id THEN
    v_type  := 'event_venue_changed';
    v_title := '📍 Cambio de ubicación';
  ELSE
    RETURN NEW;  -- no meaningful change
  END IF;

  v_etitle := COALESCE(NULLIF(NEW.title,''), 'el evento');

  v_body := CASE v_type
    WHEN 'event_cancelled'    THEN '"' || v_etitle || '" ha sido cancelado. Recibirás info sobre el reembolso.'
    WHEN 'event_date_changed' THEN '"' || v_etitle || '" cambió de fecha/hora. Revisa los detalles antes de ir.'
    WHEN 'event_venue_changed' THEN '"' || v_etitle || '" cambió de lugar. Abre el mapa para ver el nuevo sitio.'
    ELSE ''
  END;

  v_data := jsonb_build_object(
    'type',v_type,'event_id',NEW.id::text,'eventId',NEW.id::text,'event_title',v_etitle
  );

  -- Notify all valid ticket holders
  FOR r IN
    SELECT DISTINCT t.user_id
    FROM public.tickets t
    WHERE t.event_id  = NEW.id
      AND t.user_id IS NOT NULL
      AND COALESCE(t.status,'') IN ('valid','active')
  LOOP
    PERFORM public.push_notify(
      r.user_id, v_type, v_title, v_body, v_data,
      0  -- no dedup: always notify on cancellation/date/venue change
    );
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END;
$$;

CREATE TRIGGER trg_event_update
AFTER UPDATE ON public.events
FOR EACH ROW EXECUTE FUNCTION public.on_event_updated();

-- ── 6. TRIGGER D: tickets UPDATE → worker validates ticket ───────
CREATE OR REPLACE FUNCTION public.on_ticket_validated()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event  public.events%ROWTYPE;
  v_etitle text;
BEGIN
  -- Only fire when status transitions to 'used'
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.status <> 'used' THEN RETURN NEW; END IF;
  IF NEW.user_id IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO v_event FROM public.events WHERE id = NEW.event_id;
  v_etitle := COALESCE(NULLIF(v_event.title,''), 'tu evento');

  PERFORM public.push_notify(
    NEW.user_id, 'ticket_validated', '✅ Entrada validada',
    'Tu entrada para "' || v_etitle || '" fue escaneada. ¡Disfruta!',
    jsonb_build_object('type','ticket_validated','event_id',COALESCE(NEW.event_id::text,''),
      'eventId',COALESCE(NEW.event_id::text,''),'event_title',v_etitle,'ticket_id',NEW.id::text),
    10
  );

  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ticket_validated
AFTER UPDATE ON public.tickets
FOR EACH ROW EXECUTE FUNCTION public.on_ticket_validated();

-- ── 7. TRIGGER E: profiles UPDATE → organizer verification ───────
CREATE OR REPLACE FUNCTION public.on_organizer_verification_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.verification_status IS NOT DISTINCT FROM OLD.verification_status THEN
    RETURN NEW;
  END IF;

  IF NEW.verification_status = 'verified' THEN
    PERFORM public.push_notify(
      NEW.id, 'organizer_verified', '✅ Perfil verificado',
      'Tu perfil de organizador ha sido verificado. Ya puedes crear eventos públicos.',
      '{"type":"organizer_verified"}'::jsonb, 0
    );
  ELSIF NEW.verification_status IN ('rejected','needs_correction') THEN
    PERFORM public.push_notify(
      NEW.id, 'organizer_rejected', '❗Verificación rechazada',
      'Tu perfil necesita correcciones: ' ||
        COALESCE(NULLIF(NEW.verification_rejection_reason,''),'revisa tu información') ||
        '. Actualízalo e inténtalo de nuevo.',
      jsonb_build_object('type','organizer_rejected',
        'reason',COALESCE(NEW.verification_rejection_reason,'')),
      0
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END;
$$;

CREATE TRIGGER trg_organizer_verification
AFTER UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.on_organizer_verification_changed();

-- ── 8. CRON: reminders 24h and 1h before event ──────────────────
CREATE OR REPLACE FUNCTION public.schedule_event_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  r record;
BEGIN
  -- 24-hour reminder
  FOR r IN
    SELECT DISTINCT COALESCE(t.user_id, p.id) AS uid,
           e.id AS eid, COALESCE(e.title,'Tu evento') AS etitle
    FROM public.tickets t
    JOIN public.events e ON e.id = t.event_id
    LEFT JOIN public.profiles p
      ON t.user_id IS NULL AND lower(p.email) = lower(t.buyer_email)
    WHERE (t.user_id IS NOT NULL OR p.id IS NOT NULL)
      AND COALESCE(t.status,'') IN ('valid','active')
      AND e.event_date BETWEEN (now() + interval '23 hours')
                            AND (now() + interval '25 hours')
  LOOP
    PERFORM public.push_notify(
      r.uid, 'event_reminder_24h', '🌙 Tu evento es mañana',
      '"' || r.etitle || '" es mañana. Ten el QR listo y revisa el lugar.',
      jsonb_build_object('type','event_reminder_24h','event_id',r.eid::text,'eventId',r.eid::text,'event_title',r.etitle),
      3600
    );
  END LOOP;

  -- 1-hour reminder
  FOR r IN
    SELECT DISTINCT COALESCE(t.user_id, p.id) AS uid,
           e.id AS eid, COALESCE(e.title,'Tu evento') AS etitle
    FROM public.tickets t
    JOIN public.events e ON e.id = t.event_id
    LEFT JOIN public.profiles p
      ON t.user_id IS NULL AND lower(p.email) = lower(t.buyer_email)
    WHERE (t.user_id IS NOT NULL OR p.id IS NOT NULL)
      AND COALESCE(t.status,'') IN ('valid','active')
      AND e.event_date BETWEEN (now() + interval '45 minutes')
                            AND (now() + interval '75 minutes')
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

SELECT cron.schedule(
  'schedule-event-notifications',
  '*/15 * * * *',
  'SELECT public.schedule_event_notifications();'
);

NOTIFY pgrst, 'reload schema';
