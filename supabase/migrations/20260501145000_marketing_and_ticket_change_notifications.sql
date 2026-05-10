CREATE OR REPLACE FUNCTION public.notify_event_marketing_to_buyers(
  p_event_id uuid,
  p_type text,
  p_title text,
  p_body text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event public.events%ROWTYPE;
  r record;
  v_data jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_event
  FROM public.events
  WHERE id = p_event_id;

  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'Event not found';
  END IF;

  IF NOT (
    auth.uid() = v_event.creator_id
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  FOR r IN
    SELECT DISTINCT t.user_id
    FROM public.tickets t
    WHERE t.event_id = p_event_id
      AND t.user_id IS NOT NULL
      AND t.status = 'valid'
  LOOP
    v_data := jsonb_build_object(
      'event_id', v_event.id::text,
      'event_title', COALESCE(v_event.title, ''),
      'title', COALESCE(p_title, ''),
      'body', COALESCE(p_body, '')
    );
    BEGIN
      PERFORM public.enqueue_notification(r.user_id, 'attendee', p_type, COALESCE(NULLIF(p_title, ''), 'Oferta'), COALESCE(NULLIF(p_body, ''), ''), 'normal', v_data);
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END LOOP;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.notify_event_marketing_to_buyers(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_event_marketing_to_buyers(uuid, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.notify_ticket_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event public.events%ROWTYPE;
  v_old_type public.event_ticket_types%ROWTYPE;
  v_new_type public.event_ticket_types%ROWTYPE;
  v_data jsonb;
BEGIN
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM 'valid' THEN
    RETURN NEW;
  END IF;

  IF (OLD.ticket_type_id IS NOT DISTINCT FROM NEW.ticket_type_id)
     AND (OLD.quantity IS NOT DISTINCT FROM NEW.quantity)
     AND (OLD.total_price IS NOT DISTINCT FROM NEW.total_price) THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_event
  FROM public.events
  WHERE id = NEW.event_id;

  IF OLD.ticket_type_id IS NOT NULL THEN
    SELECT * INTO v_old_type
    FROM public.event_ticket_types
    WHERE id = OLD.ticket_type_id;
  END IF;

  IF NEW.ticket_type_id IS NOT NULL THEN
    SELECT * INTO v_new_type
    FROM public.event_ticket_types
    WHERE id = NEW.ticket_type_id;
  END IF;

  v_data := jsonb_build_object(
    'event_id', COALESCE(NEW.event_id::text, ''),
    'event_title', COALESCE(v_event.title, ''),
    'ticket_id', COALESCE(NEW.id::text, ''),
    'old_ticket_type', COALESCE(v_old_type.name, ''),
    'new_ticket_type', COALESCE(v_new_type.name, ''),
    'old_quantity', COALESCE(OLD.quantity, 1)::text,
    'new_quantity', COALESCE(NEW.quantity, 1)::text
  );

  BEGIN
    PERFORM public.enqueue_notification_from_template(NEW.user_id, 'attendee', 'ticket_upgraded_or_changed', v_data);
  EXCEPTION WHEN others THEN
    NULL;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_ticket_changed ON public.tickets;
CREATE TRIGGER trg_notify_ticket_changed
AFTER UPDATE OF ticket_type_id, quantity, total_price ON public.tickets
FOR EACH ROW
EXECUTE FUNCTION public.notify_ticket_changed();

INSERT INTO public.notification_templates (key, title_template, body_template, default_priority, default_channels, dedupe_seconds, enabled)
VALUES
  ('ticket_upgraded_or_changed', '🎟️ Tu entrada ha cambiado', 'Se han actualizado los detalles de tu entrada para "{{event_title}}". Revisa la nueva información.', 'high', ARRAY['in_app','push','email']::text[], 0, true)
ON CONFLICT (key) DO UPDATE
SET
  title_template = EXCLUDED.title_template,
  body_template = EXCLUDED.body_template,
  default_priority = EXCLUDED.default_priority,
  default_channels = EXCLUDED.default_channels,
  dedupe_seconds = EXCLUDED.dedupe_seconds,
  enabled = EXCLUDED.enabled,
  updated_at = now();

INSERT INTO public.notification_template_translations (key, language, title_template, body_template)
VALUES
  ('ticket_upgraded_or_changed', 'en', '🎟️ Your ticket changed', 'Your ticket details for "{{event_title}}" were updated. Please review the new info.'),
  ('ticket_upgraded_or_changed', 'fr', '🎟️ Votre billet a changé', 'Les détails de votre billet pour "{{event_title}}" ont été mis à jour. Vérifiez la nouvelle info.')
ON CONFLICT (key, language) DO UPDATE
SET
  title_template = EXCLUDED.title_template,
  body_template = EXCLUDED.body_template,
  updated_at = now();

NOTIFY pgrst, 'reload schema';
