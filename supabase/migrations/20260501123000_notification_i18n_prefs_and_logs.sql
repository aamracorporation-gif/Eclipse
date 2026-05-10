CREATE TABLE IF NOT EXISTS public.notification_template_translations (
  key text NOT NULL REFERENCES public.notification_templates(key) ON DELETE CASCADE,
  language text NOT NULL,
  title_template text NOT NULL,
  body_template text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key, language)
);

ALTER TABLE public.notification_settings
  ADD COLUMN IF NOT EXISTS marketing_opt_in boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS marketing_opt_in_at timestamptz,
  ADD COLUMN IF NOT EXISTS push_opt_out_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_opt_out_at timestamptz,
  ADD COLUMN IF NOT EXISTS sms_opt_out_at timestamptz;

CREATE TABLE IF NOT EXISTS public.notification_delivery_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL REFERENCES public.notification_deliveries(id) ON DELETE CASCADE,
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  user_id uuid,
  channel text NOT NULL,
  status text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  provider text,
  provider_message_id text,
  last_error text,
  event_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_delivery_events_user_created_at
ON public.notification_delivery_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_delivery_events_event_created_at
ON public.notification_delivery_events(event_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.log_notification_delivery_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
  v_event_id uuid;
BEGIN
  SELECT n.user_id,
         NULLIF(COALESCE(n.data->>'event_id', ''), '')::uuid
  INTO v_user_id, v_event_id
  FROM public.notifications n
  WHERE n.id = NEW.notification_id;

  INSERT INTO public.notification_delivery_events(
    delivery_id,
    notification_id,
    user_id,
    channel,
    status,
    attempts,
    provider,
    provider_message_id,
    last_error,
    event_id
  )
  VALUES (
    NEW.id,
    NEW.notification_id,
    v_user_id,
    NEW.channel,
    NEW.status,
    COALESCE(NEW.attempts, 0),
    NEW.provider,
    NEW.provider_message_id,
    NEW.last_error,
    v_event_id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_notification_delivery_event ON public.notification_deliveries;
CREATE TRIGGER trg_log_notification_delivery_event
AFTER UPDATE OF status ON public.notification_deliveries
FOR EACH ROW
EXECUTE FUNCTION public.log_notification_delivery_event();

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
  v_allowed text[];
  v_settings public.notification_settings%ROWTYPE;
  v_is_marketing boolean := false;
  v_push_enabled boolean := true;
  v_email_enabled boolean := true;
  v_sms_enabled boolean := true;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id required';
  END IF;
  IF p_type IS NULL OR length(p_type) = 0 THEN
    RAISE EXCEPTION 'type required';
  END IF;

  v_is_marketing := (p_type IN ('event_discount','event_offer','marketing_offer'));

  BEGIN
    SELECT * INTO v_settings
    FROM public.notification_settings s
    WHERE s.user_id = p_user_id;
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;

  IF v_settings.user_id IS NOT NULL THEN
    IF v_settings.muted_until IS NOT NULL AND v_settings.muted_until > now() THEN
      RETURN;
    END IF;

    IF v_is_marketing AND COALESCE(v_settings.marketing_opt_in, false) = false THEN
      RETURN;
    END IF;

    BEGIN
      v_push_enabled := COALESCE(v_settings.push_enabled, true);
      v_email_enabled := COALESCE(v_settings.email_enabled, true);
      v_sms_enabled := COALESCE(v_settings.sms_enabled, true);
    EXCEPTION WHEN undefined_column THEN
      v_push_enabled := true;
      v_email_enabled := true;
      v_sms_enabled := true;
    END;
  END IF;

  SELECT count(*) INTO v_recent_count
  FROM public.notifications
  WHERE user_id = p_user_id
    AND created_at > now() - interval '1 minute';

  SELECT COALESCE(t.default_channels, ARRAY['in_app','push']::text[]) INTO v_channels
  FROM public.notification_templates t
  WHERE t.key = p_type AND t.enabled = true;

  v_channels := COALESCE(v_channels, ARRAY['in_app','push']::text[]);

  v_allowed := ARRAY(
    SELECT c FROM unnest(v_channels) AS c
    WHERE c = 'in_app'
       OR (c = 'push' AND v_push_enabled)
       OR (c = 'email' AND v_email_enabled)
       OR (c = 'sms' AND v_sms_enabled)
  );

  IF COALESCE(array_length(v_allowed, 1), 0) = 0 THEN
    v_allowed := ARRAY['in_app']::text[];
  END IF;

  IF v_recent_count >= 5 THEN
    INSERT INTO public.notifications(user_id, role, type, title, body, data, priority, status, error_message, channels)
    VALUES (p_user_id, COALESCE(p_role, 'attendee'), p_type, COALESCE(p_title, 'Notificación'), COALESCE(p_body, ''), COALESCE(p_data, '{}'::jsonb), COALESCE(p_priority, 'normal'), 'blocked', 'rate_limited', v_allowed);
    RETURN;
  END IF;

  INSERT INTO public.notifications(user_id, role, type, title, body, data, priority, status, channels)
  VALUES (p_user_id, COALESCE(p_role, 'attendee'), p_type, COALESCE(p_title, 'Notificación'), COALESCE(p_body, ''), COALESCE(p_data, '{}'::jsonb), COALESCE(p_priority, 'normal'), 'pending', v_allowed);
END;
$$;

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
  v_lang text := 'es';
  v_tr public.notification_template_translations%ROWTYPE;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  BEGIN
    SELECT COALESCE(NULLIF(p.language, ''), 'es') INTO v_lang
    FROM public.profiles p
    WHERE p.id = p_user_id;
  EXCEPTION WHEN others THEN
    v_lang := 'es';
  END;

  SELECT * INTO v_tpl
  FROM public.notification_templates
  WHERE key = p_type
    AND enabled = true;

  IF v_tpl.key IS NULL THEN
    PERFORM public.enqueue_notification(
      p_user_id,
      p_role,
      p_type,
      'Notificación',
      COALESCE(p_data->>'message', p_type),
      'normal',
      p_data
    );
    RETURN;
  END IF;

  IF COALESCE(v_tpl.dedupe_seconds, 0) > 0 THEN
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

  SELECT * INTO v_tr
  FROM public.notification_template_translations tt
  WHERE tt.key = p_type
    AND tt.language = v_lang;

  BEGIN
    v_title := public.render_notification_template(COALESCE(NULLIF(v_tr.title_template, ''), v_tpl.title_template), p_data);
    v_body := public.render_notification_template(COALESCE(NULLIF(v_tr.body_template, ''), v_tpl.body_template), p_data);
  EXCEPTION
    WHEN undefined_function THEN
      v_title := COALESCE(NULLIF(v_tr.title_template, ''), v_tpl.title_template);
      v_body := COALESCE(NULLIF(v_tr.body_template, ''), v_tpl.body_template);
    WHEN others THEN
      v_title := COALESCE(NULLIF(v_tr.title_template, ''), v_tpl.title_template);
      v_body := COALESCE(NULLIF(v_tr.body_template, ''), v_tpl.body_template);
  END;

  PERFORM public.enqueue_notification(p_user_id, p_role, p_type, v_title, v_body, COALESCE(NULLIF(v_tpl.default_priority, ''), 'normal'), p_data);
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_notification(uuid, text, text, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_notification(uuid, text, text, text, text, text, jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.enqueue_notification_from_template(uuid, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_notification_from_template(uuid, text, text, jsonb) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
