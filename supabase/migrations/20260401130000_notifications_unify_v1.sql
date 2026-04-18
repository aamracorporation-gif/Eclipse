-- Notifications System (Unified Schema + Templates + Rate Limiting + RPC)
-- Safe to run multiple times.

-- Core notifications table (ensure required columns exist)
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS role text DEFAULT 'attendee',
  ADD COLUMN IF NOT EXISTS type text,
  ADD COLUMN IF NOT EXISTS title text DEFAULT 'Notificación',
  ADD COLUMN IF NOT EXISTS body text,
  ADD COLUMN IF NOT EXISTS data jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS priority text DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS read_at timestamptz,
  ADD COLUMN IF NOT EXISTS channels text[] DEFAULT ARRAY['in_app','push']::text[];

-- Backfill compatibility: if legacy "message" exists, copy to body when body is null
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='notifications' AND column_name='message'
  ) THEN
    UPDATE public.notifications
    SET body = COALESCE(body, message)
    WHERE body IS NULL;
  END IF;
END $$;

-- Ensure body is not null (for new pipeline that expects body)
ALTER TABLE public.notifications
  ALTER COLUMN body SET DEFAULT '',
  ALTER COLUMN body SET NOT NULL;

-- Keep legacy message non-blocking if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='notifications' AND column_name='message'
  ) THEN
    ALTER TABLE public.notifications ALTER COLUMN message DROP NOT NULL;
  END IF;
END $$;

-- Constraints (drop + recreate safely)
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_priority_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_priority_check CHECK (priority IN ('low','normal','high'));

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_status_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_status_check CHECK (status IN ('pending','sent','failed','blocked','read'));

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_role_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_role_check CHECK (role IN ('attendee','organizer','staff','admin'));

-- Ensure user_id FK exists (only if column is present and constraint missing)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'notifications_user_id_fkey'
  ) THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT notifications_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_notifications_user_created_at ON public.notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_status ON public.notifications(status);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON public.notifications(type);

-- Templates table
CREATE TABLE IF NOT EXISTS public.notification_templates (
  key text PRIMARY KEY,
  title_template text NOT NULL,
  body_template text NOT NULL,
  default_priority text NOT NULL DEFAULT 'normal' CHECK (default_priority IN ('low','normal','high')),
  default_channels text[] NOT NULL DEFAULT ARRAY['in_app','push']::text[],
  dedupe_seconds int NOT NULL DEFAULT 120,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Simple template renderer: replaces {{var}} with values from jsonb
CREATE OR REPLACE FUNCTION public.render_notification_template(p_template text, p_data jsonb)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_out text := p_template;
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

-- Enqueue notification (compatible with existing triggers/functions in this project)
CREATE OR REPLACE FUNCTION public.enqueue_notification(
  p_user_id uuid,
  p_role text,
  p_type text,
  p_title text,
  p_body text,
  p_priority text DEFAULT 'normal',
  p_data jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_recent_count int;
  v_channels text[];
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id required';
  END IF;
  IF p_type IS NULL OR length(p_type) = 0 THEN
    RAISE EXCEPTION 'type required';
  END IF;

  SELECT count(*) INTO v_recent_count
  FROM public.notifications
  WHERE user_id = p_user_id
    AND created_at > now() - interval '1 minute';

  SELECT COALESCE(t.default_channels, ARRAY['in_app','push']::text[]) INTO v_channels
  FROM public.notification_templates t
  WHERE t.key = p_type AND t.enabled = true;

  v_channels := COALESCE(v_channels, ARRAY['in_app','push']::text[]);

  IF v_recent_count >= 5 THEN
    INSERT INTO public.notifications(user_id, role, type, title, body, data, priority, status, error_message, channels)
    VALUES (p_user_id, COALESCE(p_role, 'attendee'), p_type, COALESCE(p_title, 'Notificación'), COALESCE(p_body, ''), COALESCE(p_data, '{}'::jsonb), COALESCE(p_priority, 'normal'), 'blocked', 'rate_limited', v_channels);
    RETURN;
  END IF;

  INSERT INTO public.notifications(user_id, role, type, title, body, data, priority, status, channels)
  VALUES (p_user_id, COALESCE(p_role, 'attendee'), p_type, COALESCE(p_title, 'Notificación'), COALESCE(p_body, ''), COALESCE(p_data, '{}'::jsonb), COALESCE(p_priority, 'normal'), 'pending', v_channels);
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_notification(uuid, text, text, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_notification(uuid, text, text, text, text, text, jsonb) TO authenticated, service_role;

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

CREATE OR REPLACE FUNCTION public.notify(
  p_user_id uuid,
  p_role text,
  p_type text,
  p_message text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM public.enqueue_notification(p_user_id, p_role, p_type, 'Notificación', COALESCE(p_message, ''), 'normal', jsonb_build_object('message', COALESCE(p_message, '')));
END;
$$;

REVOKE ALL ON FUNCTION public.notify(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify(uuid, text, text, text) TO authenticated, service_role;

-- Mark all as read RPC (used by the app)
CREATE OR REPLACE FUNCTION public.mark_all_notifications_read(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.notifications
  SET read_at = now(), status = 'read'
  WHERE user_id = p_user_id
    AND (read_at IS NULL OR status IS DISTINCT FROM 'read');
END;
$$;

REVOKE ALL ON FUNCTION public.mark_all_notifications_read(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read(uuid) TO authenticated, service_role;

-- Seed templates (idempotent)
INSERT INTO public.notification_templates (key, title_template, body_template, default_priority, default_channels, dedupe_seconds, enabled)
VALUES
  ('purchase_completed', '🎉 ¡Compra completada!', '¡Listo, {{name}}! Tu compra para \"{{event_title}}\" se confirmó. Tienes {{quantity}} entrada(s) lista(s) en Mis Entradas.', 'high', ARRAY['in_app','push']::text[], 60, true),
  ('ticket_ready', '🎟️ Tu entrada está lista', 'Tu QR para \"{{event_title}}\" ya está disponible. Muéstralo en la entrada.', 'normal', ARRAY['in_app','push']::text[], 120, true),
  ('event_modified', '🔁 Cambios en el evento', 'Hubo cambios en \"{{event_title}}\". Revisa los nuevos detalles antes de ir.', 'high', ARRAY['in_app','push']::text[], 300, true),
  ('event_cancelled', '⚠️ Evento cancelado', '\"{{event_title}}\" ha sido cancelado. Estamos gestionando el reembolso si aplica.', 'high', ARRAY['in_app','push']::text[], 300, true),
  ('security_alert', '🚩 Alerta de seguridad', '{{message}}', 'high', ARRAY['in_app','push']::text[], 60, true)
ON CONFLICT (key) DO UPDATE
SET
  title_template = EXCLUDED.title_template,
  body_template = EXCLUDED.body_template,
  default_priority = EXCLUDED.default_priority,
  default_channels = EXCLUDED.default_channels,
  dedupe_seconds = EXCLUDED.dedupe_seconds,
  enabled = EXCLUDED.enabled,
  updated_at = now();

-- Reload schema cache for PostgREST
NOTIFY pgrst, 'reload schema';
