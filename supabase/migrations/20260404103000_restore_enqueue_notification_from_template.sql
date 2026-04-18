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
BEGIN
  BEGIN
    INSERT INTO public.notifications(user_id, role, type, title, body, data, priority, status, channels)
    VALUES (p_user_id, COALESCE(p_role, 'attendee'), p_type, COALESCE(p_title, 'Notificación'), COALESCE(p_body, ''), COALESCE(p_data, '{}'::jsonb), COALESCE(p_priority, 'normal'), 'pending', ARRAY['in_app','push']::text[]);
    RETURN;
  EXCEPTION
    WHEN undefined_column THEN
      NULL;
    WHEN undefined_table THEN
      RETURN;
    WHEN others THEN
      NULL;
  END;

  BEGIN
    INSERT INTO public.notifications(user_id, role, type, body, data, priority, status)
    VALUES (p_user_id, COALESCE(p_role, 'attendee'), p_type, COALESCE(p_body, ''), COALESCE(p_data, '{}'::jsonb), COALESCE(p_priority, 'normal'), 'pending');
    RETURN;
  EXCEPTION
    WHEN undefined_column THEN
      NULL;
    WHEN undefined_table THEN
      RETURN;
    WHEN others THEN
      NULL;
  END;

  BEGIN
    INSERT INTO public.notifications(user_id, message, created_at)
    VALUES (p_user_id, COALESCE(p_body, ''), now());
    RETURN;
  EXCEPTION
    WHEN undefined_table THEN
      RETURN;
    WHEN others THEN
      RETURN;
  END;
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
  BEGIN
    SELECT * INTO v_tpl FROM public.notification_templates WHERE key = p_type AND enabled = true;
  EXCEPTION
    WHEN undefined_table THEN
      PERFORM public.enqueue_notification(p_user_id, p_role, p_type, 'Notificación', COALESCE(p_data->>'message', p_type), 'normal', p_data);
      RETURN;
    WHEN others THEN
      PERFORM public.enqueue_notification(p_user_id, p_role, p_type, 'Notificación', COALESCE(p_data->>'message', p_type), 'normal', p_data);
      RETURN;
  END;

  IF v_tpl.key IS NULL THEN
    PERFORM public.enqueue_notification(p_user_id, p_role, p_type, 'Notificación', COALESCE(p_data->>'message', p_type), 'normal', p_data);
    RETURN;
  END IF;

  IF v_tpl.dedupe_seconds > 0 THEN
    BEGIN
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
    EXCEPTION
      WHEN others THEN
        NULL;
    END;
  END IF;

  BEGIN
    v_title := public.render_notification_template(v_tpl.title_template, p_data);
    v_body := public.render_notification_template(v_tpl.body_template, p_data);
  EXCEPTION
    WHEN undefined_function THEN
      v_title := v_tpl.title_template;
      v_body := v_tpl.body_template;
    WHEN others THEN
      v_title := v_tpl.title_template;
      v_body := v_tpl.body_template;
  END;

  PERFORM public.enqueue_notification(p_user_id, p_role, p_type, v_title, v_body, v_tpl.default_priority, p_data);
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_notification_from_template(uuid, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_notification_from_template(uuid, text, text, jsonb) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
