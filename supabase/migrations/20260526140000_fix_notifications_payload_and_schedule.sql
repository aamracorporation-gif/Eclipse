CREATE OR REPLACE FUNCTION public.crearNotificacion(
  p_usuario_id uuid,
  p_tipo public.notificacion_tipo,
  p_referencia_evento_id uuid,
  p_titulo text,
  p_mensaje text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_existing uuid;
  v_dedupe_seconds int;
  v_role text;
  v_recent_count int;
  v_channels text[];
  v_status text;
  v_error text;
  v_priority text;
  v_id uuid;
  v_data jsonb;
BEGIN
  IF p_usuario_id IS NULL THEN
    RAISE EXCEPTION 'usuario_id required';
  END IF;

  v_dedupe_seconds := CASE
    WHEN p_tipo = 'entrada_validada' THEN 10
    ELSE 43200
  END;

  SELECT n.id INTO v_existing
  FROM public.notifications n
  WHERE n.user_id = p_usuario_id
    AND n.tipo = p_tipo
    AND n.referencia_evento_id IS NOT DISTINCT FROM p_referencia_evento_id
    AND n.created_at > now() - make_interval(secs => v_dedupe_seconds)
  ORDER BY n.created_at DESC
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  BEGIN
    SELECT COALESCE(NULLIF(p.role, ''), 'attendee') INTO v_role
    FROM public.profiles p
    WHERE p.id = p_usuario_id;
  EXCEPTION
    WHEN undefined_table THEN
      v_role := 'attendee';
    WHEN undefined_column THEN
      v_role := 'attendee';
    WHEN others THEN
      v_role := 'attendee';
  END;

  v_role := COALESCE(v_role, 'attendee');

  BEGIN
    SELECT COALESCE(t.default_channels, ARRAY['in_app','push']::text[]) INTO v_channels
    FROM public.notification_templates t
    WHERE t.key = p_tipo::text AND t.enabled = true;
  EXCEPTION
    WHEN undefined_table THEN
      v_channels := ARRAY['in_app','push']::text[];
    WHEN undefined_column THEN
      v_channels := ARRAY['in_app','push']::text[];
    WHEN others THEN
      v_channels := ARRAY['in_app','push']::text[];
  END;

  v_channels := COALESCE(v_channels, ARRAY['in_app','push']::text[]);

  SELECT count(*) INTO v_recent_count
  FROM public.notifications
  WHERE user_id = p_usuario_id
    AND created_at > now() - interval '1 minute';

  v_status := 'pending';
  v_error := NULL;
  IF v_recent_count >= 5 THEN
    v_status := 'blocked';
    v_error := 'rate_limited';
  END IF;

  v_priority := CASE
    WHEN p_tipo IN ('compra_entrada','compra_vip','compra_reventa','entrada_validada') THEN 'high'
    WHEN p_tipo IN ('evento_proximo_24h','evento_proximo_3h','evento_proximo_30min','evento_manana') THEN 'high'
    ELSE 'normal'
  END;

  v_data := jsonb_build_object(
    'event_id', COALESCE(p_referencia_evento_id::text, ''),
    'eventId', COALESCE(p_referencia_evento_id::text, ''),
    'url', CASE WHEN p_referencia_evento_id IS NULL THEN '' ELSE ('event/' || p_referencia_evento_id::text) END,
    'event_url', CASE WHEN p_referencia_evento_id IS NULL THEN '' ELSE ('event/' || p_referencia_evento_id::text) END,
    'tipo', p_tipo::text
  );

  BEGIN
    INSERT INTO public.notifications (
      user_id,
      role,
      type,
      title,
      body,
      data,
      priority,
      status,
      error_message,
      channels,
      tipo,
      referencia_evento_id,
      read
    )
    VALUES (
      p_usuario_id,
      v_role,
      p_tipo::text,
      COALESCE(NULLIF(p_titulo, ''), 'Notificación'),
      COALESCE(NULLIF(p_mensaje, ''), ''),
      v_data,
      v_priority,
      v_status,
      v_error,
      v_channels,
      p_tipo,
      p_referencia_evento_id,
      false
    )
    RETURNING id INTO v_id;
  EXCEPTION
    WHEN undefined_column THEN
      INSERT INTO public.notifications (
        user_id,
        role,
        type,
        message,
        created_at,
        tipo,
        referencia_evento_id
      )
      VALUES (
        p_usuario_id,
        v_role,
        p_tipo::text,
        COALESCE(NULLIF(p_mensaje, ''), ''),
        now(),
        p_tipo,
        p_referencia_evento_id
      )
      RETURNING id INTO v_id;
    WHEN others THEN
      INSERT INTO public.notifications (
        user_id,
        role,
        type,
        message,
        created_at
      )
      VALUES (
        p_usuario_id,
        v_role,
        p_tipo::text,
        COALESCE(NULLIF(p_mensaje, ''), ''),
        now()
      )
      RETURNING id INTO v_id;
  END;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.schedule_event_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  r record;
BEGIN
  BEGIN
    FOR r IN
      SELECT DISTINCT COALESCE(t.user_id, p.id) AS user_id, e.id AS event_id
      FROM public.tickets t
      JOIN public.events e ON e.id = t.event_id
      LEFT JOIN public.profiles p ON t.user_id IS NULL AND lower(p.email) = lower(t.buyer_email)
      WHERE (t.user_id IS NOT NULL OR p.id IS NOT NULL)
        AND (COALESCE(t.status, '') IN ('valid','active') OR COALESCE(t.ticket_status, '') = 'active')
        AND e.event_date BETWEEN (now() + interval '23 hours') AND (now() + interval '25 hours')
    LOOP
      PERFORM public.crearNotificacion(
        r.user_id,
        'evento_proximo_24h',
        r.event_id,
        '⏰ Evento próximo',
        'Tu evento es mañana. Ve preparándote 🎉'
      );
    END LOOP;
  EXCEPTION
    WHEN undefined_column THEN
      BEGIN
        FOR r IN
          SELECT DISTINCT COALESCE(t.user_id, p.id) AS user_id, e.id AS event_id
          FROM public.tickets t
          JOIN public.events e ON e.id = t.event_id
          LEFT JOIN public.profiles p ON t.user_id IS NULL AND lower(p.email) = lower(t.buyer_email)
          WHERE (t.user_id IS NOT NULL OR p.id IS NOT NULL)
            AND COALESCE(t.status, '') IN ('valid','active')
            AND e.event_date BETWEEN (now() + interval '23 hours') AND (now() + interval '25 hours')
        LOOP
          PERFORM public.crearNotificacion(
            r.user_id,
            'evento_proximo_24h',
            r.event_id,
            '⏰ Evento próximo',
            'Tu evento es mañana. Ve preparándote 🎉'
          );
        END LOOP;
      EXCEPTION
        WHEN undefined_column THEN
          FOR r IN
            SELECT DISTINCT t.user_id, e.id AS event_id
            FROM public.tickets t
            JOIN public.events e ON e.id = t.event_id
            WHERE t.user_id IS NOT NULL
              AND COALESCE(t.status, '') IN ('valid','active')
              AND e.event_date BETWEEN (now() + interval '23 hours') AND (now() + interval '25 hours')
          LOOP
            PERFORM public.crearNotificacion(
              r.user_id,
              'evento_proximo_24h',
              r.event_id,
              '⏰ Evento próximo',
              'Tu evento es mañana. Ve preparándote 🎉'
            );
          END LOOP;
      END;
  END;

  BEGIN
    FOR r IN
      SELECT DISTINCT COALESCE(t.user_id, p.id) AS user_id, e.id AS event_id
      FROM public.tickets t
      JOIN public.events e ON e.id = t.event_id
      LEFT JOIN public.profiles p ON t.user_id IS NULL AND lower(p.email) = lower(t.buyer_email)
      WHERE (t.user_id IS NOT NULL OR p.id IS NOT NULL)
        AND (COALESCE(t.status, '') IN ('valid','active') OR COALESCE(t.ticket_status, '') = 'active')
        AND e.event_date BETWEEN (now() + interval '2 hours 45 minutes') AND (now() + interval '3 hours 15 minutes')
    LOOP
      PERFORM public.crearNotificacion(
        r.user_id,
        'evento_proximo_3h',
        r.event_id,
        '⏰ Evento próximo',
        'Tu evento empieza en 3 horas'
      );
    END LOOP;
  EXCEPTION
    WHEN undefined_column THEN
      BEGIN
        FOR r IN
          SELECT DISTINCT COALESCE(t.user_id, p.id) AS user_id, e.id AS event_id
          FROM public.tickets t
          JOIN public.events e ON e.id = t.event_id
          LEFT JOIN public.profiles p ON t.user_id IS NULL AND lower(p.email) = lower(t.buyer_email)
          WHERE (t.user_id IS NOT NULL OR p.id IS NOT NULL)
            AND COALESCE(t.status, '') IN ('valid','active')
            AND e.event_date BETWEEN (now() + interval '2 hours 45 minutes') AND (now() + interval '3 hours 15 minutes')
        LOOP
          PERFORM public.crearNotificacion(
            r.user_id,
            'evento_proximo_3h',
            r.event_id,
            '⏰ Evento próximo',
            'Tu evento empieza en 3 horas'
          );
        END LOOP;
      EXCEPTION
        WHEN undefined_column THEN
          FOR r IN
            SELECT DISTINCT t.user_id, e.id AS event_id
            FROM public.tickets t
            JOIN public.events e ON e.id = t.event_id
            WHERE t.user_id IS NOT NULL
              AND COALESCE(t.status, '') IN ('valid','active')
              AND e.event_date BETWEEN (now() + interval '2 hours 45 minutes') AND (now() + interval '3 hours 15 minutes')
          LOOP
            PERFORM public.crearNotificacion(
              r.user_id,
              'evento_proximo_3h',
              r.event_id,
              '⏰ Evento próximo',
              'Tu evento empieza en 3 horas'
            );
          END LOOP;
      END;
  END;

  BEGIN
    FOR r IN
      SELECT DISTINCT COALESCE(t.user_id, p.id) AS user_id, e.id AS event_id
      FROM public.tickets t
      JOIN public.events e ON e.id = t.event_id
      LEFT JOIN public.profiles p ON t.user_id IS NULL AND lower(p.email) = lower(t.buyer_email)
      WHERE (t.user_id IS NOT NULL OR p.id IS NOT NULL)
        AND (COALESCE(t.status, '') IN ('valid','active') OR COALESCE(t.ticket_status, '') = 'active')
        AND e.event_date BETWEEN (now() + interval '20 minutes') AND (now() + interval '40 minutes')
    LOOP
      PERFORM public.crearNotificacion(
        r.user_id,
        'evento_proximo_30min',
        r.event_id,
        '⏰ Evento próximo',
        'Tu evento empieza en 30 minutos. Es hora de ir'
      );
    END LOOP;
  EXCEPTION
    WHEN undefined_column THEN
      BEGIN
        FOR r IN
          SELECT DISTINCT COALESCE(t.user_id, p.id) AS user_id, e.id AS event_id
          FROM public.tickets t
          JOIN public.events e ON e.id = t.event_id
          LEFT JOIN public.profiles p ON t.user_id IS NULL AND lower(p.email) = lower(t.buyer_email)
          WHERE (t.user_id IS NOT NULL OR p.id IS NOT NULL)
            AND COALESCE(t.status, '') IN ('valid','active')
            AND e.event_date BETWEEN (now() + interval '20 minutes') AND (now() + interval '40 minutes')
        LOOP
          PERFORM public.crearNotificacion(
            r.user_id,
            'evento_proximo_30min',
            r.event_id,
            '⏰ Evento próximo',
            'Tu evento empieza en 30 minutos. Es hora de ir'
          );
        END LOOP;
      EXCEPTION
        WHEN undefined_column THEN
          FOR r IN
            SELECT DISTINCT t.user_id, e.id AS event_id
            FROM public.tickets t
            JOIN public.events e ON e.id = t.event_id
            WHERE t.user_id IS NOT NULL
              AND COALESCE(t.status, '') IN ('valid','active')
              AND e.event_date BETWEEN (now() + interval '20 minutes') AND (now() + interval '40 minutes')
          LOOP
            PERFORM public.crearNotificacion(
              r.user_id,
              'evento_proximo_30min',
              r.event_id,
              '⏰ Evento próximo',
              'Tu evento empieza en 30 minutos. Es hora de ir'
            );
          END LOOP;
      END;
  END;
END;
$$;

NOTIFY pgrst, 'reload schema';
