-- Add missing reminder templates (3h, 30min) and improve all reminder/organizer messages
INSERT INTO public.notification_templates (key, title_template, body_template, default_priority, default_channels, dedupe_seconds, enabled)
VALUES
  ('event_reminder_3h',    '⏰ Tu evento empieza en 3 horas',   '"{{event_title}}" empieza en 3 horas. ¡Prepárate, ten el QR listo!',          'high', ARRAY['in_app','push']::text[], 3600, true),
  ('event_reminder_30min', '🚨 ¡Empieza en 30 minutos!',        '"{{event_title}}" empieza en 30 minutos. ¡Es hora de ir!',                    'high', ARRAY['in_app','push']::text[], 1800, true)
ON CONFLICT (key) DO UPDATE
SET
  title_template     = EXCLUDED.title_template,
  body_template      = EXCLUDED.body_template,
  default_priority   = EXCLUDED.default_priority,
  default_channels   = EXCLUDED.default_channels,
  dedupe_seconds     = EXCLUDED.dedupe_seconds,
  enabled            = EXCLUDED.enabled,
  updated_at         = now();

-- Update existing templates with clearer messages
UPDATE public.notification_templates SET
  title_template = '🌙 Tu evento es mañana',
  body_template  = '"{{event_title}}" es mañana. Ten el QR listo y revisa el lugar.',
  dedupe_seconds = 3600,
  updated_at     = now()
WHERE key = 'event_reminder_24h';

UPDATE public.notification_templates SET
  title_template = '⏳ Falta 1 hora',
  body_template  = '"{{event_title}}" empieza en 1 hora. ¡Sal ya!',
  dedupe_seconds = 1800,
  updated_at     = now()
WHERE key = 'event_reminder_1h';

UPDATE public.notification_templates SET
  title_template = '💰 Nueva venta',
  body_template  = 'Se ha vendido {{quantity}} entrada(s) de "{{event_title}}". Total acumulado en el dashboard.',
  updated_at     = now()
WHERE key = 'organizer_realtime_sale';

UPDATE public.notification_templates SET
  title_template = '🎟️ Compra confirmada',
  body_template  = 'Tu entrada para "{{event_title}}" está lista. Ve a "Entradas" para ver el QR.',
  updated_at     = now()
WHERE key = 'purchase_completed';

UPDATE public.notification_templates SET
  title_template = '✅ Compra confirmada',
  body_template  = 'Tu entrada para "{{event_title}}" está lista. Ve a "Entradas" para ver el QR.',
  updated_at     = now()
WHERE key = 'purchase_success';

UPDATE public.notification_templates SET
  title_template = '💸 ¡Entrada vendida!',
  body_template  = 'Vendiste tu entrada para "{{event_title}}". El pago está en camino.',
  updated_at     = now()
WHERE key = 'resale_sold';

-- Translations for new templates
INSERT INTO public.notification_template_translations (key, language, title_template, body_template)
VALUES
  ('event_reminder_3h',    'en', '⏰ Your event starts in 3 hours',  '"{{event_title}}" starts in 3 hours. Get your QR ready!'),
  ('event_reminder_3h',    'fr', '⏰ Votre événement commence dans 3 heures', '"{{event_title}}" commence dans 3 heures. Préparez votre QR !'),
  ('event_reminder_30min', 'en', '🚨 Starts in 30 minutes!',          '"{{event_title}}" starts in 30 minutes. Time to go!'),
  ('event_reminder_30min', 'fr', '🚨 Commence dans 30 minutes !',     '"{{event_title}}" commence dans 30 minutes. Il est temps de partir !')
ON CONFLICT (key, language) DO UPDATE
SET
  title_template = EXCLUDED.title_template,
  body_template  = EXCLUDED.body_template,
  updated_at     = now();

-- Rewrite schedule_event_notifications to use templates (includes event_title, adds 1h window)
CREATE OR REPLACE FUNCTION public.schedule_event_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  r record;
BEGIN
  -- 24h reminder
  FOR r IN
    SELECT DISTINCT
      COALESCE(t.user_id, p.id) AS user_id,
      e.id   AS event_id,
      COALESCE(e.title, 'Tu evento') AS event_title
    FROM public.tickets t
    JOIN public.events e ON e.id = t.event_id
    LEFT JOIN public.profiles p ON t.user_id IS NULL AND lower(p.email) = lower(t.buyer_email)
    WHERE (t.user_id IS NOT NULL OR p.id IS NOT NULL)
      AND (
        COALESCE(t.status, '') IN ('valid','active')
        OR COALESCE(t.ticket_status, '') = 'active'
      )
      AND e.event_date BETWEEN (now() + interval '23 hours') AND (now() + interval '25 hours')
  LOOP
    PERFORM public.enqueue_notification_from_template(
      r.user_id,
      'attendee',
      'event_reminder_24h',
      jsonb_build_object(
        'event_id',    r.event_id::text,
        'eventId',     r.event_id::text,
        'event_title', r.event_title,
        'type',        'event_reminder_24h'
      )
    );
  END LOOP;

  -- 3h reminder
  FOR r IN
    SELECT DISTINCT
      COALESCE(t.user_id, p.id) AS user_id,
      e.id   AS event_id,
      COALESCE(e.title, 'Tu evento') AS event_title
    FROM public.tickets t
    JOIN public.events e ON e.id = t.event_id
    LEFT JOIN public.profiles p ON t.user_id IS NULL AND lower(p.email) = lower(t.buyer_email)
    WHERE (t.user_id IS NOT NULL OR p.id IS NOT NULL)
      AND (
        COALESCE(t.status, '') IN ('valid','active')
        OR COALESCE(t.ticket_status, '') = 'active'
      )
      AND e.event_date BETWEEN (now() + interval '2 hours 45 minutes') AND (now() + interval '3 hours 15 minutes')
  LOOP
    PERFORM public.enqueue_notification_from_template(
      r.user_id,
      'attendee',
      'event_reminder_3h',
      jsonb_build_object(
        'event_id',    r.event_id::text,
        'eventId',     r.event_id::text,
        'event_title', r.event_title,
        'type',        'event_reminder_3h'
      )
    );
  END LOOP;

  -- 1h reminder
  FOR r IN
    SELECT DISTINCT
      COALESCE(t.user_id, p.id) AS user_id,
      e.id   AS event_id,
      COALESCE(e.title, 'Tu evento') AS event_title
    FROM public.tickets t
    JOIN public.events e ON e.id = t.event_id
    LEFT JOIN public.profiles p ON t.user_id IS NULL AND lower(p.email) = lower(t.buyer_email)
    WHERE (t.user_id IS NOT NULL OR p.id IS NOT NULL)
      AND (
        COALESCE(t.status, '') IN ('valid','active')
        OR COALESCE(t.ticket_status, '') = 'active'
      )
      AND e.event_date BETWEEN (now() + interval '45 minutes') AND (now() + interval '75 minutes')
  LOOP
    PERFORM public.enqueue_notification_from_template(
      r.user_id,
      'attendee',
      'event_reminder_1h',
      jsonb_build_object(
        'event_id',    r.event_id::text,
        'eventId',     r.event_id::text,
        'event_title', r.event_title,
        'type',        'event_reminder_1h'
      )
    );
  END LOOP;

  -- 30min reminder
  FOR r IN
    SELECT DISTINCT
      COALESCE(t.user_id, p.id) AS user_id,
      e.id   AS event_id,
      COALESCE(e.title, 'Tu evento') AS event_title
    FROM public.tickets t
    JOIN public.events e ON e.id = t.event_id
    LEFT JOIN public.profiles p ON t.user_id IS NULL AND lower(p.email) = lower(t.buyer_email)
    WHERE (t.user_id IS NOT NULL OR p.id IS NOT NULL)
      AND (
        COALESCE(t.status, '') IN ('valid','active')
        OR COALESCE(t.ticket_status, '') = 'active'
      )
      AND e.event_date BETWEEN (now() + interval '20 minutes') AND (now() + interval '40 minutes')
  LOOP
    PERFORM public.enqueue_notification_from_template(
      r.user_id,
      'attendee',
      'event_reminder_30min',
      jsonb_build_object(
        'event_id',    r.event_id::text,
        'eventId',     r.event_id::text,
        'event_title', r.event_title,
        'type',        'event_reminder_30min'
      )
    );
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
