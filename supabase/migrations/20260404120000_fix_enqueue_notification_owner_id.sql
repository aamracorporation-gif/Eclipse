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
    INSERT INTO public.notifications(owner_id, user_id, role, type, title, body, data, priority, status, channels, read)
    VALUES (p_user_id, p_user_id, COALESCE(p_role, 'attendee'), p_type, COALESCE(p_title, 'Notificación'), COALESCE(p_body, ''), COALESCE(p_data, '{}'::jsonb), COALESCE(p_priority, 'normal'), 'pending', ARRAY['in_app','push']::text[], false);
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
    INSERT INTO public.notifications(user_id, role, type, title, body, data, priority, status, channels, read)
    VALUES (p_user_id, COALESCE(p_role, 'attendee'), p_type, COALESCE(p_title, 'Notificación'), COALESCE(p_body, ''), COALESCE(p_data, '{}'::jsonb), COALESCE(p_priority, 'normal'), 'pending', ARRAY['in_app','push']::text[], false);
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
    INSERT INTO public.notifications(owner_id, message, created_at)
    VALUES (p_user_id, COALESCE(p_body, ''), now());
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

NOTIFY pgrst, 'reload schema';
