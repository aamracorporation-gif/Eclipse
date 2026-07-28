-- ================================================================
-- FIX: Eclipse credit purchase notifications + engagement notifs
-- 1. on_ticket_created now also fires on UPDATE (pending→valid)
-- 2. New engagement notification functions
-- ================================================================

-- ── 1. Fix ticket notification to catch wallet purchases ─────────
-- Wallet RPCs sometimes create ticket as 'pending' then update to
-- 'valid', so we must also listen for UPDATE transitions.

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

  -- On INSERT: only process if already valid/active
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.status,'') NOT IN ('valid','active') THEN RETURN NEW; END IF;
  END IF;

  -- On UPDATE: only process when transitioning INTO valid/active
  IF TG_OP = 'UPDATE' THEN
    IF COALESCE(NEW.status,'') NOT IN ('valid','active') THEN RETURN NEW; END IF;
    IF COALESCE(OLD.status,'') IN ('valid','active') THEN RETURN NEW; END IF; -- already was valid
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = NEW.event_id;
  v_etitle := COALESCE(NULLIF(v_event.title,''), 'tu evento');

  v_data := jsonb_build_object(
    'type','purchase_confirmed',
    'event_id',  COALESCE(NEW.event_id::text,''),
    'eventId',   COALESCE(NEW.event_id::text,''),
    'event_title', v_etitle,
    'ticket_id', NEW.id::text
  );

  -- Buyer: 43200s dedup prevents double-fire if card+ticket both trigger
  PERFORM public.push_notify(
    NEW.user_id, 'purchase_confirmed',
    '🎟️ Compra confirmada',
    'Tu entrada para "' || v_etitle || '" está lista. Ve a Mis Entradas para ver el QR.',
    v_data, 43200
  );

  -- Organizer: 60s dedup so multi-ticket purchases collapse
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

-- Re-attach trigger for both INSERT and UPDATE
DROP TRIGGER IF EXISTS trg_ticket_created ON public.tickets;
CREATE TRIGGER trg_ticket_created
AFTER INSERT OR UPDATE ON public.tickets
FOR EACH ROW EXECUTE FUNCTION public.on_ticket_created();

-- ── 2. Engagement: notify previous attendees when new event published ──
CREATE OR REPLACE FUNCTION public.on_event_published()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  r        record;
  v_etitle text;
  v_data   jsonb;
BEGIN
  -- Only fire when status transitions to 'published' (or equivalent active state)
  IF TG_OP <> 'INSERT' AND TG_OP <> 'UPDATE' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    -- Only on first publish
    IF COALESCE(OLD.status,'draft') NOT IN ('draft','') THEN RETURN NEW; END IF;
    IF COALESCE(NEW.status,'') NOT IN ('published','active','') THEN RETURN NEW; END IF;
    -- Also fire if it was just inserted with published status
  END IF;

  IF NEW.creator_id IS NULL THEN RETURN NEW; END IF;

  v_etitle := COALESCE(NULLIF(NEW.title,''), 'un nuevo evento');
  v_data := jsonb_build_object(
    'type', 'new_event_from_organizer',
    'event_id', NEW.id::text,
    'eventId',  NEW.id::text,
    'event_title', v_etitle
  );

  -- Notify users who attended a previous event from this organizer
  FOR r IN
    SELECT DISTINCT t.user_id
    FROM public.tickets t
    JOIN public.events e ON e.id = t.event_id
    WHERE e.creator_id = NEW.creator_id
      AND e.id <> NEW.id
      AND t.user_id IS NOT NULL
      AND t.user_id IS DISTINCT FROM NEW.creator_id
      AND COALESCE(t.status,'') IN ('valid','active','used')
    LIMIT 200
  LOOP
    PERFORM public.push_notify(
      r.user_id, 'new_event_from_organizer',
      '🎉 Nuevo evento disponible',
      'El organizador que conoces acaba de publicar "' || v_etitle || '". ¡Consigue tu entrada antes de que se agoten!',
      v_data, 86400  -- 24h dedup per organizer
    );
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_event_published ON public.events;
CREATE TRIGGER trg_event_published
AFTER INSERT OR UPDATE ON public.events
FOR EACH ROW EXECUTE FUNCTION public.on_event_published();

-- ── 3. Engagement: low stock warning ─────────────────────────────
-- Runs every 15 min via cron. Notifies users with tickets for events
-- where stock drops below 10%. Organizer also gets alerted.
CREATE OR REPLACE FUNCTION public.notify_low_stock()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  r record;
  s record;
BEGIN
  FOR r IN
    SELECT e.id, e.title, e.creator_id,
           e.available_tickets,
           e.sold_tickets,
           (e.available_tickets + e.sold_tickets) AS total
    FROM public.events e
    WHERE e.event_date > now()
      AND e.available_tickets > 0
      AND (e.available_tickets + e.sold_tickets) > 0
      AND e.available_tickets::float / (e.available_tickets + e.sold_tickets)::float < 0.1
  LOOP
    -- Notify organizer once
    IF r.creator_id IS NOT NULL THEN
      PERFORM public.push_notify(
        r.creator_id, 'stock_low',
        '🔥 ¡Casi sin entradas!',
        'Solo quedan ' || r.available_tickets::text || ' entradas de "' || COALESCE(r.title,'tu evento') || '". Comparte el evento.',
        jsonb_build_object('type','stock_low','event_id',r.id::text,'eventId',r.id::text,'event_title',COALESCE(r.title,'')),
        3600  -- once per hour max
      );
    END IF;

    -- Notify ticket holders so they share with friends
    FOR s IN
      SELECT DISTINCT t.user_id
      FROM public.tickets t
      WHERE t.event_id = r.id
        AND t.user_id IS NOT NULL
        AND COALESCE(t.status,'') IN ('valid','active')
      LIMIT 50
    LOOP
      PERFORM public.push_notify(
        s.user_id, 'event_almost_full',
        '🔥 ¡Casi sin entradas!',
        '"' || COALESCE(r.title,'Tu evento') || '" se está agotando. ¡Compártelo con tus amigos!',
        jsonb_build_object('type','event_almost_full','event_id',r.id::text,'eventId',r.id::text,'event_title',COALESCE(r.title,'')),
        86400  -- once per day per user
      );
    END LOOP;
  END LOOP;
END;
$$;

-- ── 4. Engagement: weekly recap for organizers (Sundays 18:00) ───
CREATE OR REPLACE FUNCTION public.notify_organizer_weekly_recap()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT
      e.creator_id,
      COUNT(t.id)     FILTER (WHERE t.created_at > now() - interval '7 days') AS weekly_sales,
      COUNT(t.id)     AS total_sales,
      SUM(tt.price)   FILTER (WHERE t.created_at > now() - interval '7 days') AS weekly_revenue,
      (SELECT title FROM public.events WHERE creator_id = e.creator_id ORDER BY event_date DESC LIMIT 1) AS latest_event
    FROM public.tickets t
    JOIN public.events e ON e.id = t.event_id
    JOIN public.event_ticket_types tt ON tt.id = t.ticket_type_id
    WHERE e.creator_id IS NOT NULL
      AND COALESCE(t.status,'') IN ('valid','active','used')
    GROUP BY e.creator_id
    HAVING COUNT(t.id) FILTER (WHERE t.created_at > now() - interval '7 days') > 0
  LOOP
    PERFORM public.push_notify(
      r.creator_id, 'organizer_weekly_recap',
      '📊 Tu resumen semanal',
      'Esta semana vendiste ' || r.weekly_sales::text || ' entradas' ||
        CASE WHEN r.weekly_revenue > 0 THEN ' y generaste ' || round(r.weekly_revenue)::text || '€.' ELSE '.' END ||
        ' ¡Sigue así!',
      jsonb_build_object(
        'type','organizer_weekly_recap',
        'weekly_sales', r.weekly_sales,
        'weekly_revenue', COALESCE(r.weekly_revenue, 0)
      ),
      604800  -- once per week dedup
    );
  END LOOP;
END;
$$;

-- ── 5. Schedule new cron jobs ────────────────────────────────────
SELECT cron.schedule(
  'notify-low-stock',
  '*/15 * * * *',
  'SELECT public.notify_low_stock();'
);

SELECT cron.schedule(
  'notify-organizer-weekly-recap',
  '0 18 * * 0',
  'SELECT public.notify_organizer_weekly_recap();'
);

-- ── 6. Update _layout.tsx navigation types ───────────────────────
-- (handled in app code — new types added: new_event_from_organizer,
--  stock_low, event_almost_full, organizer_weekly_recap)

NOTIFY pgrst, 'reload schema';
