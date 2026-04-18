-- Notifications core tables

CREATE TABLE IF NOT EXISTS public.user_push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token text NOT NULL,
  platform text CHECK (platform IN ('ios','android','web')) DEFAULT 'android',
  created_at timestamptz DEFAULT now(),
  last_used_at timestamptz DEFAULT now(),
  is_active boolean DEFAULT true
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_push_tokens_token ON public.user_push_tokens(token);

ALTER TABLE public.user_push_tokens ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_push_tokens' AND policyname = 'Users manage own push tokens') THEN
    CREATE POLICY "Users manage own push tokens"
    ON public.user_push_tokens
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- Notification preferences per user
CREATE TABLE IF NOT EXISTS public.notification_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text CHECK (role IN ('organizer','attendee','admin')) DEFAULT 'attendee',
  -- Cliente
  event_reminders boolean DEFAULT true,
  purchase_updates boolean DEFAULT true,
  resale_updates boolean DEFAULT true,
  stock_alerts boolean DEFAULT true,
  -- Organizador
  realtime_sales boolean DEFAULT true,
  daily_summary boolean DEFAULT true,
  stock_threshold_alerts boolean DEFAULT true,
  -- Global
  muted_until timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'notification_settings' AND policyname = 'Users manage own notification settings') THEN
    CREATE POLICY "Users manage own notification settings"
    ON public.notification_settings
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- Notification log / queue
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text CHECK (role IN ('organizer','attendee','admin')) DEFAULT 'attendee',
  type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  data jsonb DEFAULT '{}'::jsonb,
  priority text CHECK (priority IN ('low','normal','high')) DEFAULT 'normal',
  status text CHECK (status IN ('pending','sent','failed','blocked','read')) DEFAULT 'pending',
  error_message text,
  created_at timestamptz DEFAULT now(),
  sent_at timestamptz,
  read_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_status ON public.notifications(status);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'notifications' AND policyname = 'Users can view own notifications') THEN
    CREATE POLICY "Users can view own notifications"
    ON public.notifications
    FOR SELECT
    USING (auth.uid() = user_id);
  END IF;
END $$;

-- Function: rate limited enqueue
CREATE OR REPLACE FUNCTION public.enqueue_notification(
  p_user_id uuid,
  p_role text,
  p_type text,
  p_title text,
  p_body text,
  p_priority text DEFAULT 'normal',
  p_data jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_settings notification_settings;
  v_recent_count int;
BEGIN
  -- GDPR / opt-out and mute check
  SELECT * INTO v_settings FROM notification_settings WHERE user_id = p_user_id;
  IF v_settings.muted_until IS NOT NULL AND v_settings.muted_until > now() THEN
    RETURN;
  END IF;

  IF p_type LIKE 'event_reminder_%' AND (v_settings.event_reminders = false) THEN
    RETURN;
  END IF;

  IF p_type LIKE 'purchase_%' AND (v_settings.purchase_updates = false) THEN
    RETURN;
  END IF;

  IF p_type LIKE 'resale_%' AND (v_settings.resale_updates = false) THEN
    RETURN;
  END IF;

  IF p_type LIKE 'stock_%' AND (v_settings.stock_alerts = false) THEN
    RETURN;
  END IF;

  IF p_type LIKE 'organizer_realtime_sale%' AND (v_settings.realtime_sales = false) THEN
    RETURN;
  END IF;

  -- Rate limiting: máx 5 notificaciones / minuto por usuario
  SELECT count(*) INTO v_recent_count
  FROM notifications
  WHERE user_id = p_user_id
    AND created_at > now() - interval '1 minute';

  IF v_recent_count >= 5 THEN
    INSERT INTO notifications(user_id, role, type, title, body, data, priority, status, error_message)
    VALUES (p_user_id, p_role, p_type, p_title, p_body, p_data, p_priority, 'blocked', 'rate_limited');
    RETURN;
  END IF;

  INSERT INTO notifications(user_id, role, type, title, body, data, priority, status)
  VALUES (p_user_id, p_role, p_type, p_title, p_body, p_data, p_priority, 'pending');
END;
$$;

GRANT EXECUTE ON FUNCTION public.enqueue_notification TO authenticated;

-- Event-based triggers

-- 1) After ticket purchase: notify attendee & organizer
CREATE OR REPLACE FUNCTION public.handle_ticket_insert_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event events;
BEGIN
  SELECT * INTO v_event FROM events WHERE id = NEW.event_id;

  -- Cliente: compra realizada + entrada disponible
  IF NEW.user_id IS NOT NULL THEN
    PERFORM public.enqueue_notification(
      NEW.user_id,
      'attendee',
      'purchase_success',
      '✅ Compra realizada correctamente',
      'Tu compra para ' || v_event.title || ' se ha completado correctamente.',
      'high',
      jsonb_build_object('event_id', v_event.id, 'ticket_id', NEW.id)
    );

    PERFORM public.enqueue_notification(
      NEW.user_id,
      'attendee',
      'ticket_available',
      '📩 Entrada disponible en la app',
      'Tu entrada para ' || v_event.title || ' ya está disponible en tu perfil.',
      'normal',
      jsonb_build_object('event_id', v_event.id, 'ticket_id', NEW.id)
    );
  END IF;

  -- Organizador: venta en tiempo real
  IF v_event.creator_id IS NOT NULL THEN
    PERFORM public.enqueue_notification(
      v_event.creator_id,
      'organizer',
      'organizer_realtime_sale',
      '💰 Nueva entrada vendida',
      'Has vendido 1 entrada para ' || v_event.title,
      'normal',
      jsonb_build_object('event_id', v_event.id, 'ticket_id', NEW.id)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ticket_insert_notifications ON public.tickets;
CREATE TRIGGER trg_ticket_insert_notifications
AFTER INSERT ON public.tickets
FOR EACH ROW
EXECUTE FUNCTION public.handle_ticket_insert_notifications();

-- 2) Stock threshold & sold-out alerts
CREATE OR REPLACE FUNCTION public.handle_stock_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event events;
  v_remaining int;
  v_last_low_stock timestamptz;
BEGIN
  SELECT * INTO v_event FROM events WHERE id = NEW.event_id;
  v_remaining := v_event.available_tickets;

  IF v_event.creator_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Low stock < 10
  IF v_remaining <= 10 AND v_remaining > 0 THEN
    SELECT max(created_at) INTO v_last_low_stock
    FROM notifications
    WHERE user_id = v_event.creator_id
      AND type = 'stock_low'
      AND (data->>'event_id')::uuid = v_event.id;

    IF v_last_low_stock IS NULL OR v_last_low_stock < now() - interval '30 minutes' THEN
      PERFORM public.enqueue_notification(
        v_event.creator_id,
        'organizer',
        'stock_low',
        '⚠️ Quedan pocas entradas',
        'Quedan solo ' || v_remaining || ' entradas para ' || v_event.title,
        'high',
        jsonb_build_object('event_id', v_event.id, 'remaining', v_remaining)
      );
    END IF;
  END IF;

  -- Sold out
  IF v_remaining <= 0 THEN
    PERFORM public.enqueue_notification(
      v_event.creator_id,
      'organizer',
      'stock_sold_out',
      '❌ Sold out',
      'Tu evento ' || v_event.title || ' se ha quedado sin entradas.',
      'high',
      jsonb_build_object('event_id', v_event.id)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stock_notifications ON public.events;
CREATE TRIGGER trg_stock_notifications
AFTER UPDATE OF available_tickets ON public.events
FOR EACH ROW
EXECUTE FUNCTION public.handle_stock_notifications();

-- 3) Simple event reminder scheduler (to be called from a cron job)
CREATE OR REPLACE FUNCTION public.schedule_event_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  r RECORD;
BEGIN
  -- 24h antes
  FOR r IN
    SELECT t.user_id, e.*
    FROM tickets t
    JOIN events e ON e.id = t.event_id
    WHERE e.event_date BETWEEN (now() + interval '23 hours') AND (now() + interval '25 hours')
  LOOP
    PERFORM public.enqueue_notification(
      r.user_id,
      'attendee',
      'event_reminder_24h',
      'Mañana fiestón en tu ciudad, ¿vas a faltar?',
      'Mañana es ' || r.title || '. Prepara tu mejor outfit.',
      'high',
      jsonb_build_object('event_id', r.id)
    );
  END LOOP;

  -- 1h antes
  FOR r IN
    SELECT t.user_id, e.*
    FROM tickets t
    JOIN events e ON e.id = t.event_id
    WHERE e.event_date BETWEEN (now() + interval '55 minutes') AND (now() + interval '65 minutes')
  LOOP
    PERFORM public.enqueue_notification(
      r.user_id,
      'attendee',
      'event_reminder_1h',
      'Esta noche es la fiesta',
      'Esta noche es la fiesta ' || r.title || ' — empieza en 1 hora.',
      'high',
      jsonb_build_object('event_id', r.id)
    );
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.schedule_event_reminders TO authenticated;

