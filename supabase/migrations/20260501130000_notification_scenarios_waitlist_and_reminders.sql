DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='events' AND column_name='status'
  ) THEN
    ALTER TABLE public.events
      ADD COLUMN status text NOT NULL DEFAULT 'scheduled';
  END IF;
EXCEPTION WHEN others THEN
  NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'events_status_check'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_status_check
      CHECK (status IN ('scheduled','postponed','cancelled'));
  END IF;
EXCEPTION WHEN others THEN
  NULL;
END $$;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS is_cancelled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS is_postponed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS postponed_reason text,
  ADD COLUMN IF NOT EXISTS previous_event_date timestamptz,
  ADD COLUMN IF NOT EXISTS access_policy text DEFAULT '',
  ADD COLUMN IF NOT EXISTS access_requirements text DEFAULT '',
  ADD COLUMN IF NOT EXISTS lineup text DEFAULT '',
  ADD COLUMN IF NOT EXISTS capacity integer;

CREATE TABLE IF NOT EXISTS public.ticket_cancellations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  user_id uuid,
  event_id uuid,
  reason text,
  refund_status text NOT NULL DEFAULT 'unknown' CHECK (refund_status IN ('unknown','pending','completed','failed','not_applicable')),
  refund_reference text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ticket_cancellations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='ticket_cancellations' AND policyname='Users can view own ticket cancellations'
  ) THEN
    CREATE POLICY "Users can view own ticket cancellations"
    ON public.ticket_cancellations
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.notify_ticket_cancelled_or_refunded()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ticket public.tickets%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_data jsonb;
  v_reason text;
BEGIN
  SELECT * INTO v_ticket
  FROM public.tickets
  WHERE id = NEW.ticket_id;

  IF v_ticket.id IS NULL OR v_ticket.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_event
  FROM public.events
  WHERE id = v_ticket.event_id;

  v_reason := COALESCE(NULLIF(NEW.reason, ''), COALESCE(NULLIF(v_event.cancellation_reason, ''), ''));

  v_data := jsonb_build_object(
    'event_id', COALESCE(v_event.id::text, ''),
    'event_title', COALESCE(v_event.title, ''),
    'ticket_id', COALESCE(v_ticket.id::text, ''),
    'refund_status', COALESCE(NEW.refund_status, 'unknown'),
    'refund_reference', COALESCE(NEW.refund_reference, ''),
    'reason', COALESCE(v_reason, '')
  );

  BEGIN
    PERFORM public.enqueue_notification_from_template(v_ticket.user_id, 'attendee', 'ticket_cancelled_or_refunded', v_data);
  EXCEPTION WHEN others THEN
    NULL;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_ticket_cancelled_or_refunded ON public.ticket_cancellations;
CREATE TRIGGER trg_notify_ticket_cancelled_or_refunded
AFTER INSERT ON public.ticket_cancellations
FOR EACH ROW
EXECUTE FUNCTION public.notify_ticket_cancelled_or_refunded();

CREATE OR REPLACE FUNCTION public.record_ticket_cancellation_on_ticket_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_is_cancelled boolean := false;
BEGIN
  v_is_cancelled := (NEW.status = 'cancelled' OR NEW.ticket_status = 'invalidated');
  IF NOT v_is_cancelled THEN
    RETURN NEW;
  END IF;
  IF (OLD.status = 'cancelled' OR OLD.ticket_status = 'invalidated') THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.ticket_cancellations(ticket_id, user_id, event_id, reason, refund_status)
  VALUES (NEW.id, NEW.user_id, NEW.event_id, 'cancelled', 'unknown')
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_record_ticket_cancellation ON public.tickets;
CREATE TRIGGER trg_record_ticket_cancellation
AFTER UPDATE OF status, ticket_status ON public.tickets
FOR EACH ROW
EXECUTE FUNCTION public.record_ticket_cancellation_on_ticket_update();

CREATE TABLE IF NOT EXISTS public.event_waitlist_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','offered','claimed','expired','cancelled')),
  offer_token uuid,
  offered_at timestamptz,
  offer_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id, user_id)
);

ALTER TABLE public.event_waitlist_entries ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='event_waitlist_entries' AND policyname='Users manage own waitlist'
  ) THEN
    CREATE POLICY "Users manage own waitlist"
    ON public.event_waitlist_entries
    FOR ALL
    TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.join_event_waitlist(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO public.event_waitlist_entries(event_id, user_id, status, created_at, updated_at)
  VALUES (p_event_id, auth.uid(), 'pending', now(), now())
  ON CONFLICT (event_id, user_id) DO UPDATE
  SET status = CASE
    WHEN public.event_waitlist_entries.status IN ('claimed') THEN public.event_waitlist_entries.status
    ELSE 'pending'
  END,
  updated_at = now();

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.join_event_waitlist(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_event_waitlist(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.offer_waitlist_for_event(p_event_id uuid, p_slots int DEFAULT 1)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  r record;
  v_offered int := 0;
  v_event public.events%ROWTYPE;
  v_token uuid;
  v_data jsonb;
BEGIN
  SELECT * INTO v_event
  FROM public.events
  WHERE id = p_event_id;

  IF v_event.id IS NULL THEN
    RETURN 0;
  END IF;

  FOR r IN
    SELECT id, user_id
    FROM public.event_waitlist_entries
    WHERE event_id = p_event_id
      AND status = 'pending'
    ORDER BY created_at ASC
    LIMIT GREATEST(COALESCE(p_slots, 1), 1)
  LOOP
    v_token := gen_random_uuid();

    UPDATE public.event_waitlist_entries
    SET
      status = 'offered',
      offer_token = v_token,
      offered_at = now(),
      offer_expires_at = now() + interval '15 minutes',
      updated_at = now()
    WHERE id = r.id
      AND status = 'pending';

    v_data := jsonb_build_object(
      'event_id', v_event.id::text,
      'event_title', COALESCE(v_event.title, ''),
      'offer_token', v_token::text,
      'expires_at', (now() + interval '15 minutes')::text
    );

    BEGIN
      PERFORM public.enqueue_notification_from_template(r.user_id, 'attendee', 'waitlist_ticket_available', v_data);
    EXCEPTION WHEN others THEN
      NULL;
    END;

    v_offered := v_offered + 1;
  END LOOP;

  RETURN v_offered;
END;
$$;

REVOKE ALL ON FUNCTION public.offer_waitlist_for_event(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.offer_waitlist_for_event(uuid, int) TO service_role;

CREATE OR REPLACE FUNCTION public.on_event_stock_increase_offer_waitlist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_delta int := 0;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.available_tickets IS NULL OR OLD.available_tickets IS NULL THEN
    RETURN NEW;
  END IF;

  v_delta := NEW.available_tickets - OLD.available_tickets;
  IF v_delta > 0 THEN
    BEGIN
      PERFORM public.offer_waitlist_for_event(NEW.id, v_delta);
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_offer_waitlist_on_stock_increase ON public.events;
CREATE TRIGGER trg_offer_waitlist_on_stock_increase
AFTER UPDATE OF available_tickets ON public.events
FOR EACH ROW
EXECUTE FUNCTION public.on_event_stock_increase_offer_waitlist();

CREATE OR REPLACE FUNCTION public.claim_waitlist_offer(p_offer_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_entry public.event_waitlist_entries%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_entry
  FROM public.event_waitlist_entries
  WHERE offer_token = p_offer_token
  FOR UPDATE;

  IF v_entry.id IS NULL OR v_entry.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Offer not found';
  END IF;

  IF v_entry.status IS DISTINCT FROM 'offered' THEN
    RAISE EXCEPTION 'Offer not active';
  END IF;

  IF v_entry.offer_expires_at IS NOT NULL AND v_entry.offer_expires_at < now() THEN
    UPDATE public.event_waitlist_entries
    SET status = 'expired', updated_at = now()
    WHERE id = v_entry.id;
    RAISE EXCEPTION 'Offer expired';
  END IF;

  UPDATE public.event_waitlist_entries
  SET status = 'claimed', updated_at = now()
  WHERE id = v_entry.id;

  RETURN jsonb_build_object('success', true, 'event_id', v_entry.event_id::text);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_waitlist_offer(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_waitlist_offer(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.schedule_event_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  r record;
  v_data jsonb;
  v_event public.events%ROWTYPE;
  v_venue public.venues%ROWTYPE;
BEGIN
  FOR r IN
    SELECT DISTINCT ON (t.user_id, e.id)
      t.user_id,
      e.id AS event_id,
      e.title AS event_title,
      e.event_date,
      e.venue_id,
      t.id AS ticket_id,
      COALESCE(t.qr_token::text, '') AS qr_token
    FROM public.tickets t
    JOIN public.events e ON e.id = t.event_id
    WHERE t.user_id IS NOT NULL
      AND t.status = 'valid'
      AND e.event_date BETWEEN (now() + interval '23 hours 30 minutes') AND (now() + interval '24 hours 30 minutes')
    ORDER BY t.user_id, e.id, t.id ASC
  LOOP
    SELECT * INTO v_event FROM public.events WHERE id = r.event_id;
    SELECT * INTO v_venue FROM public.venues WHERE id = v_event.venue_id;

    v_data := jsonb_build_object(
      'event_id', r.event_id::text,
      'event_title', COALESCE(r.event_title, ''),
      'event_date', COALESCE(r.event_date::text, ''),
      'ticket_id', COALESCE(r.ticket_id::text, ''),
      'qr_token', COALESCE(r.qr_token, ''),
      'venue_name', COALESCE(v_venue.name, ''),
      'venue_address', COALESCE(v_venue.address, '')
    );

    PERFORM public.enqueue_notification_from_template(r.user_id, 'attendee', 'event_reminder_24h', v_data);
  END LOOP;

  FOR r IN
    SELECT DISTINCT ON (t.user_id, e.id)
      t.user_id,
      e.id AS event_id,
      e.title AS event_title,
      e.event_date,
      e.venue_id,
      t.id AS ticket_id,
      COALESCE(t.qr_token::text, '') AS qr_token
    FROM public.tickets t
    JOIN public.events e ON e.id = t.event_id
    WHERE t.user_id IS NOT NULL
      AND t.status = 'valid'
      AND e.event_date BETWEEN (now() + interval '55 minutes') AND (now() + interval '65 minutes')
    ORDER BY t.user_id, e.id, t.id ASC
  LOOP
    SELECT * INTO v_event FROM public.events WHERE id = r.event_id;
    SELECT * INTO v_venue FROM public.venues WHERE id = v_event.venue_id;

    v_data := jsonb_build_object(
      'event_id', r.event_id::text,
      'event_title', COALESCE(r.event_title, ''),
      'event_date', COALESCE(r.event_date::text, ''),
      'ticket_id', COALESCE(r.ticket_id::text, ''),
      'qr_token', COALESCE(r.qr_token, ''),
      'venue_name', COALESCE(v_venue.name, ''),
      'venue_address', COALESCE(v_venue.address, '')
    );

    PERFORM public.enqueue_notification_from_template(r.user_id, 'attendee', 'event_reminder_1h', v_data);
  END LOOP;
END;
$$;

INSERT INTO public.notification_templates (key, title_template, body_template, default_priority, default_channels, dedupe_seconds, enabled)
VALUES
  ('ticket_cancelled_or_refunded', '❗Entrada cancelada', 'Tu entrada para "{{event_title}}" ha sido cancelada. {{reason}}', 'high', ARRAY['in_app','push','email','sms']::text[], 0, true),
  ('event_reminder_1h', '⏳ Falta 1 hora', 'En 1 hora empieza "{{event_title}}". Ten tu QR listo.', 'high', ARRAY['in_app','push']::text[], 1800, true),
  ('waitlist_ticket_available', '🎟️ Entrada disponible', 'Hay una entrada disponible para "{{event_title}}". Tienes hasta {{expires_at}} para comprar.', 'high', ARRAY['in_app','push','email']::text[], 0, true),
  ('event_offer', '✨ Oferta para tu evento', 'Hay una oferta para "{{event_title}}".', 'normal', ARRAY['in_app','push']::text[], 0, true),
  ('event_discount', '🏷️ Descuento disponible', 'Se ha aplicado un descuento para "{{event_title}}".', 'normal', ARRAY['in_app','push']::text[], 0, true)
ON CONFLICT (key) DO UPDATE
SET
  title_template = EXCLUDED.title_template,
  body_template = EXCLUDED.body_template,
  default_priority = EXCLUDED.default_priority,
  default_channels = EXCLUDED.default_channels,
  dedupe_seconds = EXCLUDED.dedupe_seconds,
  enabled = EXCLUDED.enabled,
  updated_at = now();

NOTIFY pgrst, 'reload schema';
