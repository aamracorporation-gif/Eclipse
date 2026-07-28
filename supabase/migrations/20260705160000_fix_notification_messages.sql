-- Clean up all notification trigger message bodies.
-- Goals:
--   - Natural Spanish, no "(s)" ambiguity
--   - Clear action context in every message
--   - Consistent style across all types

-- ── 1. on_payment_fulfilled (card purchases) ─────────────────────
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

  IF NEW.kind IN ('event_ticket','vip_table') THEN
    SELECT * INTO v_event FROM public.events
    WHERE id = NULLIF(NEW.metadata->>'event_id','')::uuid;
    IF v_event.id IS NULL THEN RETURN NEW; END IF;

    v_etitle := COALESCE(NULLIF(v_event.title,''), 'tu evento');
    v_data := jsonb_build_object(
      'type','purchase_confirmed',
      'event_id',v_event.id::text,'eventId',v_event.id::text,
      'event_title',v_etitle,'quantity',v_qty::text
    );

    -- Buyer
    PERFORM public.push_notify(
      NEW.user_id, 'purchase_confirmed',
      '🎟️ ¡Compra confirmada!',
      CASE WHEN v_qty = 1
        THEN 'Tienes 1 entrada para "' || v_etitle || '". Encuéntrala en Mis Entradas.'
        ELSE 'Tienes ' || v_qty::text || ' entradas para "' || v_etitle || '". Encuéntralas en Mis Entradas.'
      END,
      v_data, 43200
    );

    -- Organizer
    IF v_event.creator_id IS NOT NULL AND v_event.creator_id IS DISTINCT FROM NEW.user_id THEN
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
    v_data := jsonb_build_object(
      'type','resale_purchased',
      'event_id',COALESCE(v_event.id::text,''),
      'eventId',COALESCE(v_event.id::text,''),
      'event_title',v_etitle
    );

    PERFORM public.push_notify(
      NEW.user_id, 'resale_purchased',
      '🎟️ ¡Reventa confirmada!',
      'Tu entrada de reventa para "' || v_etitle || '" está lista. Búscala en Mis Entradas.',
      v_data, 43200
    );

    IF v_listing.seller_id IS NOT NULL AND v_listing.seller_id IS DISTINCT FROM NEW.user_id THEN
      PERFORM public.push_notify(
        v_listing.seller_id, 'resale_sold',
        '💸 ¡Entrada vendida!',
        'Vendiste tu entrada de "' || v_etitle || '" en reventa. El pago está en camino.',
        v_data || '{"type":"resale_sold"}'::jsonb, 43200
      );
    END IF;

    IF v_event.creator_id IS NOT NULL THEN
      PERFORM public.push_notify(
        v_event.creator_id, 'organizer_new_sale',
        '💰 Venta de reventa',
        'Se vendió una entrada de reventa de "' || v_etitle || '".',
        v_data || '{"type":"organizer_new_sale"}'::jsonb, 60
      );
    END IF;
  END IF;

  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END;
$$;

-- ── 2. on_ticket_created (wallet / créditos purchases) ───────────
CREATE OR REPLACE FUNCTION public.on_ticket_created()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
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
    'type','purchase_confirmed',
    'event_id',COALESCE(NEW.event_id::text,''),
    'eventId',COALESCE(NEW.event_id::text,''),
    'event_title',v_etitle,
    'ticket_id',NEW.id::text
  );

  -- 43200s dedup: won't double-notify if card purchase already fired
  PERFORM public.push_notify(
    NEW.user_id, 'purchase_confirmed',
    '🎟️ ¡Compra confirmada!',
    'Tienes 1 entrada para "' || v_etitle || '". Encuéntrala en Mis Entradas.',
    v_data, 43200
  );

  IF v_event.creator_id IS NOT NULL AND v_event.creator_id IS DISTINCT FROM NEW.user_id THEN
    PERFORM public.push_notify(
      v_event.creator_id, 'organizer_new_sale',
      '💰 Nueva venta',
      'Vendiste 1 entrada de "' || v_etitle || '".',
      v_data || '{"type":"organizer_new_sale"}'::jsonb, 60
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END;
$$;

-- ── 3. on_event_updated (organizer edits) ────────────────────────
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
  IF NEW.event_date   IS NOT DISTINCT FROM OLD.event_date
     AND NEW.venue_id IS NOT DISTINCT FROM OLD.venue_id
     AND NEW.title    IS NOT DISTINCT FROM OLD.title
     AND COALESCE(NEW.status,'') NOT ILIKE 'cancel%'
  THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.status,'') ILIKE 'cancel%'
     AND COALESCE(OLD.status,'') NOT ILIKE 'cancel%' THEN
    v_type  := 'event_cancelled';
    v_title := '❌ Evento cancelado';
  ELSIF NEW.event_date IS DISTINCT FROM OLD.event_date THEN
    v_type  := 'event_date_changed';
    v_title := '⏰ Cambio de fecha';
  ELSIF NEW.venue_id IS DISTINCT FROM OLD.venue_id THEN
    v_type  := 'event_venue_changed';
    v_title := '📍 Cambio de lugar';
  ELSIF NEW.title IS DISTINCT FROM OLD.title THEN
    v_type  := 'event_updated';
    v_title := '🔁 Evento actualizado';
  ELSE
    RETURN NEW;
  END IF;

  v_etitle := COALESCE(NULLIF(NEW.title,''), 'el evento');

  v_body := CASE v_type
    WHEN 'event_cancelled'
      THEN '"' || v_etitle || '" ha sido cancelado por el organizador. Recibirás info sobre el reembolso.'
    WHEN 'event_date_changed'
      THEN 'El organizador cambió la fecha de "' || v_etitle || '". Revisa los nuevos detalles.'
    WHEN 'event_venue_changed'
      THEN 'El organizador cambió el lugar de "' || v_etitle || '". Abre el mapa para ver dónde es ahora.'
    WHEN 'event_updated'
      THEN 'El organizador actualizó "' || v_etitle || '". Revisa los nuevos detalles.'
    ELSE ''
  END;

  v_data := jsonb_build_object(
    'type',v_type,
    'event_id',NEW.id::text,'eventId',NEW.id::text,
    'event_title',v_etitle
  );

  FOR r IN
    SELECT DISTINCT t.user_id
    FROM public.tickets t
    WHERE t.event_id = NEW.id
      AND t.user_id IS NOT NULL
      AND COALESCE(t.status,'') IN ('valid','active')
  LOOP
    PERFORM public.push_notify(r.user_id, v_type, v_title, v_body, v_data, 60);
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END;
$$;

-- ── 4. on_ticket_validated (worker scans QR) ─────────────────────
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
      'event_id',COALESCE(NEW.event_id::text,''),
      'eventId',COALESCE(NEW.event_id::text,''),
      'event_title',v_etitle,
      'ticket_id',NEW.id::text
    ),
    10
  );

  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END;
$$;

-- ── 5. on_organizer_verification_changed ─────────────────────────
CREATE OR REPLACE FUNCTION public.on_organizer_verification_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.verification_status IS NOT DISTINCT FROM OLD.verification_status THEN
    RETURN NEW;
  END IF;

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
      jsonb_build_object(
        'type','organizer_rejected',
        'reason',COALESCE(NEW.verification_rejection_reason,'')
      ),
      0
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END;
$$;

-- ── 6. schedule_event_notifications (cron reminders) ─────────────
CREATE OR REPLACE FUNCTION public.schedule_event_notifications()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  r record;
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
      r.uid, 'event_reminder_24h',
      '🌙 Tu evento es mañana',
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
      r.uid, 'event_reminder_1h',
      '⏰ ¡Tu evento empieza en 1 hora!',
      '"' || r.etitle || '" empieza en 1 hora. ¡Sal ya y lleva el QR!',
      jsonb_build_object('type','event_reminder_1h','event_id',r.eid::text,'eventId',r.eid::text,'event_title',r.etitle),
      1800
    );
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
