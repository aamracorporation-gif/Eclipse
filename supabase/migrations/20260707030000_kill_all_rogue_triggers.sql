-- ================================================================
-- KILL ALL ROGUE NOTIFICATION TRIGGERS
-- Discovered via live DB inspection: 8 extra triggers were firing
-- on every event/ticket/venue update, causing wrong notifications.
-- ================================================================

-- ── 1. CANCEL ALL OLD PENDING DELIVERIES (start fresh) ──────────
UPDATE public.notification_deliveries
SET status     = 'failed',
    last_error = 'system_reset_v3'
WHERE status = 'pending';

-- ── 2. DROP EVERY ROGUE NOTIFICATION TRIGGER ────────────────────

-- events table: 3 rogue triggers
DROP TRIGGER IF EXISTS trg_notify_attendees_event_modified     ON public.events;
DROP TRIGGER IF EXISTS trg_dispatch_notifications_after_event_update ON public.events;
-- (keep trg_event_update → our clean on_event_updated)

-- tickets table: rogue trigger
DROP TRIGGER IF EXISTS trg_notify_ticket_changed               ON public.tickets;
-- (keep trg_ticket_validated → our clean on_ticket_validated)

-- venues table: 2 rogue triggers
DROP TRIGGER IF EXISTS trg_venue_update_notify_event_buyers    ON public.venues;
DROP TRIGGER IF EXISTS trg_dispatch_notifications_after_venue_update ON public.venues;

-- ledger table: rogue trigger
DROP TRIGGER IF EXISTS trg_ledger_movimientos_notifications    ON public.ledger_movimientos;

-- ── 3. MAKE ROGUE FUNCTIONS NO-OPS ──────────────────────────────
-- These functions are still referenced but their triggers are gone.
-- Making them no-ops protects against any future re-attachment.

CREATE OR REPLACE FUNCTION public.notify_attendees_on_event_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION public.dispatch_notifications_async()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION public.notify_ticket_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION public.notify_event_location_changed_on_venue_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION public.handle_ledger_movimientos_notifications()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN NEW; END; $$;

-- ── 4. TICKET INSERT TRIGGER (catches wallet purchases) ──────────
-- Card purchases go through payment_transactions → trg_payment_fulfilled.
-- Wallet purchases bypass that and create tickets directly.
-- This trigger catches wallet purchases. The 43200s dedup in push_notify
-- prevents double-notification when card purchases also INSERT a ticket.

CREATE OR REPLACE FUNCTION public.on_ticket_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event  public.events%ROWTYPE;
  v_title  text;
  v_data   jsonb;
BEGIN
  -- Only care about valid new tickets with an owner
  IF NEW.user_id IS NULL THEN RETURN NEW; END IF;
  IF COALESCE(NEW.status,'') NOT IN ('valid','active') THEN RETURN NEW; END IF;

  SELECT * INTO v_event FROM public.events WHERE id = NEW.event_id;
  v_title := COALESCE(NULLIF(v_event.title,''), 'tu evento');

  v_data := jsonb_build_object(
    'type',        'purchase_confirmed',
    'event_id',    COALESCE(NEW.event_id::text,''),
    'eventId',     COALESCE(NEW.event_id::text,''),
    'event_title', v_title,
    'ticket_id',   NEW.id::text,
    'quantity',    '1'
  );

  -- Buyer notification (43200s dedup = won't double-send if card already notified)
  PERFORM public.push_notify(
    NEW.user_id,
    'purchase_confirmed',
    '🎟️ Compra confirmada',
    'Tu entrada para "' || v_title || '" está lista. Ve a Mis Entradas para ver el QR.',
    v_data,
    43200
  );

  -- Organizer notification (60s dedup = max 1 alert/min per organizer)
  IF v_event.creator_id IS NOT NULL AND v_event.creator_id IS DISTINCT FROM NEW.user_id THEN
    PERFORM public.push_notify(
      v_event.creator_id,
      'organizer_new_sale',
      '💰 Nueva venta',
      'Se vendió 1 entrada de "' || v_title || '".',
      v_data || jsonb_build_object('type','organizer_new_sale'),
      60
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ticket_created ON public.tickets;
CREATE TRIGGER trg_ticket_created
AFTER INSERT ON public.tickets
FOR EACH ROW
EXECUTE FUNCTION public.on_ticket_created();

-- ── 5. VERIFY ACTIVE NOTIFICATION TRIGGERS (documentation only) ──
-- After this migration, the ONLY notification triggers should be:
--   trg_payment_fulfilled     → payment_transactions UPDATE (card purchases)
--   trg_ticket_created        → tickets INSERT (wallet purchases)
--   trg_ticket_validated      → tickets UPDATE (worker scans ticket)
--   trg_event_update          → events UPDATE (ONLY date/venue/cancel changes)
--   trg_organizer_verification → profiles UPDATE (verification status)
--   [cron] schedule_event_notifications → every 15 min (24h + 1h reminders)

NOTIFY pgrst, 'reload schema';
