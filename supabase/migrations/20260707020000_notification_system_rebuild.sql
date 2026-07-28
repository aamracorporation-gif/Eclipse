-- ============================================================
-- COMPLETE NOTIFICATION SYSTEM REBUILD
-- Drops all old triggers/functions and rebuilds from scratch.
-- ============================================================

-- ── 1. DROP ALL OLD TRIGGERS ─────────────────────────────────
DROP TRIGGER IF EXISTS trg_payment_fulfilled_notifications    ON public.payment_transactions;
DROP TRIGGER IF EXISTS trg_notify_ticket_sale                 ON public.tickets;
DROP TRIGGER IF EXISTS trigger_notify_ticket_sale             ON public.tickets;
DROP TRIGGER IF EXISTS trg_ticket_insert_notifications        ON public.tickets;
DROP TRIGGER IF EXISTS trg_notify_ticket_validated            ON public.tickets;
DROP TRIGGER IF EXISTS on_event_update                        ON public.events;
DROP TRIGGER IF EXISTS trg_event_update                       ON public.events;
DROP TRIGGER IF EXISTS trg_notify_ticket_cancelled_or_refunded ON public.ticket_cancellations;
DROP TRIGGER IF EXISTS handle_ledger_movimientos_notifications ON public.ledger_movimientos;
DROP TRIGGER IF EXISTS trg_profile_verification_notification  ON public.profiles;

-- ── 2. MAKE ALL OLD NOTIFICATION FUNCTIONS NO-OPS ─────────────
-- (replace, not drop, to avoid CASCADE issues with triggers above)
CREATE OR REPLACE FUNCTION public.trigger_notifications_on_transaction_complete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION public.handle_payment_fulfilled_notifications()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION public.notify_ticket_sale()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION public.handle_ticket_insert_notifications()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION public.handle_event_updates_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION public.send_event_update_notifications(
  p_event_id uuid, p_old jsonb, p_new jsonb, p_force boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN END; $$;

CREATE OR REPLACE FUNCTION public.crearNotificacion(
  p_usuario_id uuid, p_tipo text, p_referencia_evento_id uuid, p_titulo text, p_mensaje text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN NULL; END; $$;

-- Old overload with enum type (handle safely)
DO $$
BEGIN
  EXECUTE $q$
    CREATE OR REPLACE FUNCTION public.crearNotificacion(
      p_usuario_id uuid, p_tipo public.notificacion_tipo, p_referencia_evento_id uuid, p_titulo text, p_mensaje text)
    RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $f$ BEGIN RETURN NULL; END; $f$;
  $q$;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.enqueue_notification(
  p_user_id uuid, p_role text, p_type text, p_title text, p_body text,
  p_priority text DEFAULT 'normal', p_data jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN END; $$;

CREATE OR REPLACE FUNCTION public.enqueue_notification_from_template(
  p_user_id uuid, p_role text, p_type text, p_data jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN END; $$;

-- ── 3. ADD next_retry_at COLUMN (if not exists) ───────────────
ALTER TABLE public.notification_deliveries
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;

-- ── 4. CLEAR OLD TEMPLATES ────────────────────────────────────
DELETE FROM public.notification_template_translations;
DELETE FROM public.notification_templates;

-- ── 5. SEED CLEAN TEMPLATES ──────────────────────────────────
INSERT INTO public.notification_templates
  (key, title_template, body_template, default_priority, default_channels, dedupe_seconds, enabled)
VALUES
  -- Attendee: purchases
  ('purchase_confirmed',   '🎟️ Compra confirmada',           'Tu entrada para "{{event_title}}" está lista. Ve a Mis Entradas para ver el QR.',              'high',   ARRAY['in_app','push']::text[], 43200, true),
  ('resale_purchased',     '🎟️ Reventa confirmada',          'Tu entrada de reventa para "{{event_title}}" está lista. Ve a Mis Entradas para ver el QR.',   'high',   ARRAY['in_app','push']::text[], 43200, true),
  ('resale_sold',          '💸 ¡Entrada vendida!',           'Vendiste tu entrada para "{{event_title}}". El pago está en camino a tu monedero.',             'high',   ARRAY['in_app','push']::text[], 43200, true),
  -- Attendee: event changes
  ('event_date_changed',   '⏰ Cambio de fecha',             '"{{event_title}}" cambió de fecha/hora. Revisa los detalles antes de ir.',                      'high',   ARRAY['in_app','push']::text[], 0,     true),
  ('event_venue_changed',  '📍 Cambio de ubicación',         '"{{event_title}}" cambió de lugar. Abre el mapa para ver el nuevo sitio.',                      'high',   ARRAY['in_app','push']::text[], 0,     true),
  ('event_cancelled',      '❌ Evento cancelado',            '"{{event_title}}" ha sido cancelado. Recibirás información sobre el reembolso.',                 'high',   ARRAY['in_app','push']::text[], 0,     true),
  ('event_updated',        '🔁 Cambios en el evento',        '"{{event_title}}" ha sido actualizado. Revisa los nuevos detalles.',                            'normal', ARRAY['in_app','push']::text[], 300,   true),
  -- Attendee: reminders
  ('event_reminder_24h',   '🌙 Tu evento es mañana',         '"{{event_title}}" es mañana. Ten el QR listo y revisa el lugar.',                               'high',   ARRAY['in_app','push']::text[], 3600,  true),
  ('event_reminder_1h',    '⏰ ¡Tu evento empieza en 1 hora!', '"{{event_title}}" empieza en 1 hora. ¡Es hora de ir!',                                       'high',   ARRAY['in_app','push']::text[], 1800,  true),
  -- Attendee: ticket validated
  ('ticket_validated',     '✅ Entrada validada',             'Tu entrada para "{{event_title}}" fue escaneada correctamente. ¡Disfruta!',                     'normal', ARRAY['in_app']::text[],         10,    true),
  -- Organizer: sales
  ('organizer_new_sale',   '💰 Nueva venta',                 'Se {{quantity}} entrada(s) de "{{event_title}}". Revisa el dashboard.',                         'high',   ARRAY['in_app','push']::text[], 60,    true),
  -- Organizer: verification
  ('organizer_verified',   '✅ Perfil verificado',           'Tu perfil de organizador ha sido verificado. Ya puedes crear eventos.',                          'high',   ARRAY['in_app','push']::text[], 0,     true),
  ('organizer_rejected',   '❗Verificación rechazada',       'Tu perfil necesita correcciones: {{reason}}. Actualiza la información e inténtalo de nuevo.',   'high',   ARRAY['in_app','push']::text[], 0,     true)
ON CONFLICT (key) DO UPDATE SET
  title_template   = EXCLUDED.title_template,
  body_template    = EXCLUDED.body_template,
  default_priority = EXCLUDED.default_priority,
  default_channels = EXCLUDED.default_channels,
  dedupe_seconds   = EXCLUDED.dedupe_seconds,
  enabled          = EXCLUDED.enabled,
  updated_at       = now();

-- ── 6. CORE FUNCTION: push_notify ────────────────────────────
-- Inserts a notification row. The trg_create_notification_deliveries
-- trigger automatically creates the push delivery row.
CREATE OR REPLACE FUNCTION public.push_notify(
  p_user_id       uuid,
  p_type          text,
  p_title         text,
  p_body          text,
  p_data          jsonb DEFAULT '{}'::jsonb,
  p_dedupe_secs   int   DEFAULT 300,
  p_channels      text[] DEFAULT ARRAY['in_app','push']::text[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_user_id IS NULL OR p_title IS NULL OR p_title = '' THEN
    RETURN NULL;
  END IF;

  -- Deduplication: skip if same type was already sent within the window
  IF p_dedupe_secs > 0 THEN
    IF EXISTS (
      SELECT 1 FROM public.notifications
      WHERE user_id   = p_user_id
        AND type      = p_type
        AND created_at > now() - make_interval(secs => p_dedupe_secs)
      LIMIT 1
    ) THEN
      RETURN NULL;
    END IF;
  END IF;

  -- Rate limit: max 10 notifications per user per minute
  IF (
    SELECT count(*) FROM public.notifications
    WHERE user_id    = p_user_id
      AND created_at > now() - interval '1 minute'
  ) >= 10 THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.notifications (
    user_id, type, title, body, data, priority, status, channels, role, read
  ) VALUES (
    p_user_id,
    p_type,
    p_title,
    COALESCE(p_body, ''),
    COALESCE(p_data, '{}'::jsonb),
    'high',
    'pending',
    p_channels,
    'attendee',
    false
  )
  RETURNING id INTO v_id;

  RETURN v_id;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.push_notify(uuid, text, text, text, jsonb, int, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.push_notify(uuid, text, text, text, jsonb, int, text[]) TO service_role;

-- ── 7. TRIGGER: Payment fulfilled → buyer + organizer ─────────
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
  v_title   text;
  v_data    jsonb;
BEGIN
  -- Only fire once: UPDATE that transitions status → 'fulfilled'
  IF TG_OP <> 'UPDATE' THEN RETURN NEW; END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.status <> 'fulfilled' THEN RETURN NEW; END IF;

  v_qty := GREATEST(COALESCE((NEW.metadata->>'quantity')::int, 1), 1);

  -- ── CASE A: Primary ticket or VIP purchase ────────────────
  IF NEW.kind IN ('event_ticket', 'vip_table') THEN
    SELECT * INTO v_event
    FROM public.events
    WHERE id = NULLIF(NEW.metadata->>'event_id', '')::uuid;

    IF v_event.id IS NULL THEN RETURN NEW; END IF;
    v_title := COALESCE(NULLIF(v_event.title,''), 'tu evento');

    v_data := jsonb_build_object(
      'type',        'purchase_confirmed',
      'event_id',    v_event.id::text,
      'eventId',     v_event.id::text,
      'event_title', v_title,
      'quantity',    v_qty::text
    );

    -- Buyer notification
    PERFORM public.push_notify(
      NEW.user_id, 'purchase_confirmed',
      '🎟️ Compra confirmada',
      CASE WHEN v_qty = 1
        THEN 'Tu entrada para "' || v_title || '" está lista. Ve a Mis Entradas para ver el QR.'
        ELSE v_qty::text || ' entradas para "' || v_title || '" están listas. Ve a Mis Entradas.'
      END,
      v_data, 43200
    );

    -- Organizer notification (different type so dedupe is per-type)
    IF v_event.creator_id IS NOT NULL AND v_event.creator_id IS DISTINCT FROM NEW.user_id THEN
      PERFORM public.push_notify(
        v_event.creator_id, 'organizer_new_sale',
        '💰 Nueva venta',
        CASE WHEN v_qty = 1
          THEN 'Se vendió 1 entrada de "' || v_title || '".'
          ELSE 'Se vendieron ' || v_qty::text || ' entradas de "' || v_title || '".'
        END,
        v_data || jsonb_build_object('type','organizer_new_sale'),
        60  -- 1 min dedup: max 1 alert/min per organizer
      );
    END IF;

  -- ── CASE B: Resale ticket purchase ───────────────────────
  ELSIF NEW.kind = 'resale_ticket' THEN
    -- Find listing
    SELECT * INTO v_listing FROM public.resale_listings
    WHERE id = NULLIF(NEW.metadata->>'listing_id','')::uuid;

    IF v_listing.id IS NULL THEN
      SELECT rl.* INTO v_listing FROM public.resale_listings rl
      JOIN public.tickets tk ON tk.id = rl.ticket_id
      WHERE tk.id = NULLIF(NEW.metadata->>'ticket_id','')::uuid
      LIMIT 1;
    END IF;

    IF v_listing.id IS NOT NULL THEN
      SELECT * INTO v_ticket FROM public.tickets WHERE id = v_listing.ticket_id;
      SELECT * INTO v_event FROM public.events WHERE id = v_ticket.event_id;
    END IF;

    v_title := COALESCE(NULLIF(v_event.title,''), 'tu evento');

    v_data := jsonb_build_object(
      'type',       'resale_purchased',
      'event_id',   COALESCE(v_event.id::text, ''),
      'eventId',    COALESCE(v_event.id::text, ''),
      'event_title', v_title,
      'listing_id', COALESCE(v_listing.id::text, '')
    );

    -- Buyer
    PERFORM public.push_notify(
      NEW.user_id, 'resale_purchased',
      '🎟️ Reventa confirmada',
      'Tu entrada de reventa para "' || v_title || '" está lista. Ve a Mis Entradas para ver el QR.',
      v_data, 43200
    );

    -- Seller
    IF v_listing.seller_id IS NOT NULL AND v_listing.seller_id IS DISTINCT FROM NEW.user_id THEN
      PERFORM public.push_notify(
        v_listing.seller_id, 'resale_sold',
        '💸 ¡Entrada vendida!',
        'Vendiste tu entrada para "' || v_title || '". El pago está en camino a tu monedero.',
        v_data || jsonb_build_object('type','resale_sold'),
        43200
      );
    END IF;

    -- Organizer
    IF v_event.creator_id IS NOT NULL THEN
      PERFORM public.push_notify(
        v_event.creator_id, 'organizer_new_sale',
        '💰 Venta de reventa',
        'Se vendió una entrada de reventa de "' || v_title || '".',
        v_data || jsonb_build_object('type','organizer_new_sale'),
        60
      );
    END IF;
  END IF;

  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_fulfilled ON public.payment_transactions;
CREATE TRIGGER trg_payment_fulfilled
AFTER UPDATE ON public.payment_transactions
FOR EACH ROW
EXECUTE FUNCTION public.on_payment_fulfilled();

-- ── 8. TRIGGER: Event update → notify attendees ───────────────
-- Only fires for fields that matter to attendees (not counter/audit fields).
CREATE OR REPLACE FUNCTION public.on_event_updated()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  r             record;
  v_title       text;
  v_data        jsonb;
  v_type        text;
  v_notif_title text;
  v_notif_body  text;
  -- Fields that never matter to attendees (counters, audit, internal)
  v_ignored     text[] := ARRAY[
    'available_tickets','sold_tickets','ticket_count','tickets_sold',
    'tickets_available','tickets_remaining','capacity_remaining',
    'available_capacity','remaining_capacity','sold_count',
    'purchase_count','vip_sold','vip_available','vip_remaining',
    'table_sold','table_available','table_remaining',
    'revenue','total_revenue','gross_revenue','net_revenue',
    'updated_at','created_at','last_sale_at','last_purchase_at',
    'stripe_account_id','payout_enabled','verification_status'
  ];
  v_date_changed    boolean := false;
  v_venue_changed   boolean := false;
  v_cancelled       boolean := false;
  v_other_changed   boolean := false;
BEGIN
  -- Skip if no meaningful change
  v_date_changed  := (NEW.event_date IS DISTINCT FROM OLD.event_date);
  v_venue_changed := (NEW.venue_id   IS DISTINCT FROM OLD.venue_id);
  v_cancelled     := (
    (COALESCE(NEW.status,'') ILIKE 'cancel%' AND COALESCE(OLD.status,'') NOT ILIKE 'cancel%')
    OR (COALESCE(NEW.is_cancelled::text,'false') = 'true' AND COALESCE(OLD.is_cancelled::text,'false') = 'false')
  );

  -- Check if any non-ignored field changed
  SELECT bool_or(TRUE) INTO v_other_changed
  FROM jsonb_each_text(to_jsonb(NEW)) AS n(k,v)
  JOIN jsonb_each_text(to_jsonb(OLD)) AS o(k,v) ON n.k = o.k
  WHERE n.v IS DISTINCT FROM o.v
    AND n.k <> ALL(v_ignored)
    AND n.k <> 'event_date'
    AND n.k <> 'venue_id';

  -- If nothing meaningful changed, bail out
  IF NOT (v_date_changed OR v_venue_changed OR v_cancelled OR v_other_changed) THEN
    RETURN NEW;
  END IF;

  v_title := COALESCE(NULLIF(NEW.title,''), 'el evento');

  -- Determine notification type and message
  IF v_cancelled THEN
    v_type        := 'event_cancelled';
    v_notif_title := '❌ Evento cancelado';
    v_notif_body  := '"' || v_title || '" ha sido cancelado. Recibirás información sobre el reembolso.';
  ELSIF v_date_changed THEN
    v_type        := 'event_date_changed';
    v_notif_title := '⏰ Cambio de fecha';
    v_notif_body  := '"' || v_title || '" cambió de fecha/hora. Revisa los detalles antes de ir.';
  ELSIF v_venue_changed THEN
    v_type        := 'event_venue_changed';
    v_notif_title := '📍 Cambio de ubicación';
    v_notif_body  := '"' || v_title || '" cambió de lugar. Abre el mapa para ver el nuevo sitio.';
  ELSE
    v_type        := 'event_updated';
    v_notif_title := '🔁 Cambios en el evento';
    v_notif_body  := '"' || v_title || '" ha sido actualizado. Revisa los nuevos detalles.';
  END IF;

  v_data := jsonb_build_object(
    'type',        v_type,
    'event_id',    NEW.id::text,
    'eventId',     NEW.id::text,
    'event_title', v_title
  );

  -- Notify all valid ticket holders
  FOR r IN
    SELECT DISTINCT t.user_id
    FROM public.tickets t
    WHERE t.event_id   = NEW.id
      AND t.user_id IS NOT NULL
      AND COALESCE(t.status,'') IN ('valid','active')
  LOOP
    PERFORM public.push_notify(
      r.user_id, v_type,
      v_notif_title, v_notif_body,
      v_data,
      -- cancelled/date/venue = 0 dedup (always notify), other changes = 5 min dedup
      CASE WHEN v_type IN ('event_cancelled','event_date_changed','event_venue_changed') THEN 0 ELSE 300 END
    );
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_event_update ON public.events;
CREATE TRIGGER trg_event_update
AFTER UPDATE ON public.events
FOR EACH ROW
EXECUTE FUNCTION public.on_event_updated();

-- ── 9. TRIGGER: Ticket validated (worker scans) ───────────────
CREATE OR REPLACE FUNCTION public.on_ticket_validated()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event public.events%ROWTYPE;
  v_title text;
BEGIN
  -- Fire when ticket goes from not-used → used/scanned
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('used','invalid') THEN
    -- Only the 'used' case is an actual successful scan
    IF NEW.status <> 'used' THEN RETURN NEW; END IF;
  ELSIF NEW.scanned_at IS NOT DISTINCT FROM OLD.scanned_at THEN
    RETURN NEW;
  END IF;

  IF NEW.user_id IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO v_event FROM public.events WHERE id = NEW.event_id;
  v_title := COALESCE(NULLIF(v_event.title,''), 'tu evento');

  PERFORM public.push_notify(
    NEW.user_id, 'ticket_validated',
    '✅ Entrada validada',
    'Tu entrada para "' || v_title || '" fue escaneada. ¡Disfruta!',
    jsonb_build_object(
      'type',        'ticket_validated',
      'event_id',    COALESCE(NEW.event_id::text,''),
      'eventId',     COALESCE(NEW.event_id::text,''),
      'event_title', v_title,
      'ticket_id',   NEW.id::text
    ),
    10  -- 10s dedup prevents double-scan alerts
  );

  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ticket_validated ON public.tickets;
CREATE TRIGGER trg_ticket_validated
AFTER UPDATE ON public.tickets
FOR EACH ROW
EXECUTE FUNCTION public.on_ticket_validated();

-- ── 10. TRIGGER: Organizer verification status change ─────────
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
      NEW.id, 'organizer_verified',
      '✅ Perfil verificado',
      'Tu perfil de organizador ha sido verificado. Ya puedes crear eventos públicos.',
      jsonb_build_object('type','organizer_verified'),
      0
    );
  ELSIF NEW.verification_status IN ('rejected','needs_correction') THEN
    PERFORM public.push_notify(
      NEW.id, 'organizer_rejected',
      '❗Verificación rechazada',
      'Tu perfil necesita correcciones: ' || COALESCE(NULLIF(NEW.verification_rejection_reason,''),'revisa tu información') || '. Actualízalo e inténtalo de nuevo.',
      jsonb_build_object('type','organizer_rejected','reason',COALESCE(NEW.verification_rejection_reason,'')),
      0
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_organizer_verification ON public.profiles;
CREATE TRIGGER trg_organizer_verification
AFTER UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.on_organizer_verification_changed();

-- ── 11. CRON: Event reminders (24h and 1h before) ────────────
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
    SELECT DISTINCT
      COALESCE(t.user_id, p.id) AS uid,
      e.id                       AS event_id,
      COALESCE(e.title, 'Tu evento') AS event_title
    FROM public.tickets t
    JOIN public.events e ON e.id = t.event_id
    LEFT JOIN public.profiles p
      ON t.user_id IS NULL AND lower(p.email) = lower(t.buyer_email)
    WHERE (t.user_id IS NOT NULL OR p.id IS NOT NULL)
      AND COALESCE(t.status,'') IN ('valid','active')
      AND e.event_date BETWEEN (now() + interval '23 hours') AND (now() + interval '25 hours')
  LOOP
    PERFORM public.push_notify(
      r.uid, 'event_reminder_24h',
      '🌙 Tu evento es mañana',
      '"' || r.event_title || '" es mañana. Ten el QR listo y revisa el lugar.',
      jsonb_build_object(
        'type','event_reminder_24h',
        'event_id', r.event_id::text,
        'eventId',  r.event_id::text,
        'event_title', r.event_title
      ),
      3600  -- don't remind twice within 1h
    );
  END LOOP;

  -- 1-hour reminder
  FOR r IN
    SELECT DISTINCT
      COALESCE(t.user_id, p.id) AS uid,
      e.id                       AS event_id,
      COALESCE(e.title, 'Tu evento') AS event_title
    FROM public.tickets t
    JOIN public.events e ON e.id = t.event_id
    LEFT JOIN public.profiles p
      ON t.user_id IS NULL AND lower(p.email) = lower(t.buyer_email)
    WHERE (t.user_id IS NOT NULL OR p.id IS NOT NULL)
      AND COALESCE(t.status,'') IN ('valid','active')
      AND e.event_date BETWEEN (now() + interval '45 minutes') AND (now() + interval '75 minutes')
  LOOP
    PERFORM public.push_notify(
      r.uid, 'event_reminder_1h',
      '⏰ ¡Tu evento empieza en 1 hora!',
      '"' || r.event_title || '" empieza en 1 hora. ¡Sal ya!',
      jsonb_build_object(
        'type','event_reminder_1h',
        'event_id', r.event_id::text,
        'eventId',  r.event_id::text,
        'event_title', r.event_title
      ),
      1800  -- don't remind twice within 30 min
    );
  END LOOP;
END;
$$;

-- Reschedule cron
SELECT cron.schedule(
  'schedule-event-notifications',
  '*/15 * * * *',
  'SELECT public.schedule_event_notifications();'
);

NOTIFY pgrst, 'reload schema';
