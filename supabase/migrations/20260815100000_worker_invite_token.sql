-- Add worker_invite_token to events so organizers can generate a per-event
-- QR code that workers scan to register themselves for that event.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS worker_invite_token uuid DEFAULT gen_random_uuid();

-- Create a unique index so tokens are always unique across events
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_worker_invite_token
  ON public.events (worker_invite_token)
  WHERE worker_invite_token IS NOT NULL;

-- RPC: organizer regenerates the invite token (invalidates old QR)
CREATE OR REPLACE FUNCTION public.regenerate_worker_invite_token(p_event_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_token uuid;
BEGIN
  -- Only the event creator can regenerate the token
  IF NOT EXISTS (
    SELECT 1 FROM public.events
    WHERE id = p_event_id AND creator_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  v_new_token := gen_random_uuid();

  UPDATE public.events
  SET worker_invite_token = v_new_token
  WHERE id = p_event_id;

  RETURN v_new_token;
END;
$$;

GRANT EXECUTE ON FUNCTION public.regenerate_worker_invite_token(uuid) TO authenticated;

-- RPC: worker joins an event using the invite token.
-- Creates a workers record if needed (matched by user email) and
-- creates a worker_event_assignments record.
CREATE OR REPLACE FUNCTION public.join_event_as_worker(
  p_event_id     uuid,
  p_invite_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id     uuid;
  v_user_email  text;
  v_user_name   text;
  v_organizer_id uuid;
  v_worker_id   uuid;
  v_event_title text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Verify token matches the event
  SELECT creator_id, title
  INTO v_organizer_id, v_event_title
  FROM public.events
  WHERE id = p_event_id
    AND worker_invite_token = p_invite_token;

  IF v_organizer_id IS NULL THEN
    RAISE EXCEPTION 'Token inválido o evento no encontrado';
  END IF;

  -- Prevent the organizer from joining their own event as a worker
  IF v_organizer_id = v_user_id THEN
    RAISE EXCEPTION 'El organizador no puede unirse como worker de su propio evento';
  END IF;

  -- Get caller info from auth
  SELECT email, COALESCE(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', email)
  INTO v_user_email, v_user_name
  FROM auth.users
  WHERE id = v_user_id;

  -- Find or create a workers record for this user under this organizer
  SELECT id INTO v_worker_id
  FROM public.workers
  WHERE organizer_id = v_organizer_id
    AND (user_id = v_user_id OR lower(email) = lower(v_user_email))
  LIMIT 1;

  IF v_worker_id IS NULL THEN
    INSERT INTO public.workers (organizer_id, user_id, email, name, status, permissions)
    VALUES (
      v_organizer_id, v_user_id,
      v_user_email, v_user_name,
      'active', '["scan"]'::jsonb
    )
    RETURNING id INTO v_worker_id;
  ELSE
    -- Make sure user_id is linked and status is active
    UPDATE public.workers
    SET user_id = v_user_id, status = 'active', updated_at = now()
    WHERE id = v_worker_id;
  END IF;

  -- Create event assignment (ignore duplicate)
  INSERT INTO public.worker_event_assignments (worker_id, event_id, status)
  VALUES (v_worker_id, p_event_id, 'active')
  ON CONFLICT (worker_id, event_id) DO UPDATE SET status = 'active';

  RETURN jsonb_build_object(
    'ok', true,
    'worker_id', v_worker_id,
    'event_id', p_event_id,
    'event_title', v_event_title
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.join_event_as_worker(uuid, uuid) TO authenticated;
