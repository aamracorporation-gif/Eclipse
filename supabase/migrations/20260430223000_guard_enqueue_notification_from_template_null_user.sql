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
  v_priority text;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

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

  v_priority := COALESCE(NULLIF(v_tpl.default_priority, ''), 'normal');

  PERFORM public.enqueue_notification(
    p_user_id,
    p_role,
    p_type,
    v_title,
    v_body,
    v_priority,
    p_data
  );
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_notification_from_template(uuid, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_notification_from_template(uuid, text, text, jsonb) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
