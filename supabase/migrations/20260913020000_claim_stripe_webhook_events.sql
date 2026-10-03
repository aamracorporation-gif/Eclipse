-- A lease coordinates HTTP workers; fulfillment itself remains a SQL transaction.
ALTER TABLE public.stripe_webhook_events
  ADD COLUMN IF NOT EXISTS processing_token uuid,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;

CREATE OR REPLACE FUNCTION public.claim_stripe_webhook_event(
  p_event_id text, p_event_type text, p_object_id text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
  v_existing public.stripe_webhook_events%ROWTYPE;
  v_token uuid := gen_random_uuid();
BEGIN
  IF nullif(btrim(p_event_id), '') IS NULL
    OR nullif(btrim(p_event_type), '') IS NULL
    OR length(p_event_id) > 255 OR length(p_event_type) > 255
    OR (p_object_id IS NOT NULL AND length(p_object_id) > 255)
  THEN
    RAISE EXCEPTION 'Invalid Stripe event claim';
  END IF;
  INSERT INTO public.stripe_webhook_events(event_id, event_type, object_id, processing_token, lease_expires_at)
  VALUES(p_event_id, p_event_type, p_object_id, v_token, now() + interval '5 minutes')
  ON CONFLICT(event_id) DO NOTHING;
  IF FOUND THEN
    RETURN jsonb_build_object('claimed', true, 'processing_token', v_token);
  END IF;

  SELECT * INTO v_existing FROM public.stripe_webhook_events WHERE event_id = p_event_id FOR UPDATE;
  IF v_existing.processing_status = 'processed' THEN
    RETURN jsonb_build_object('duplicate', true, 'claimed', false);
  END IF;
  IF v_existing.processing_status = 'processing' AND v_existing.lease_expires_at > now() THEN
    RETURN jsonb_build_object('claimed', false);
  END IF;
  UPDATE public.stripe_webhook_events
  SET processing_status = 'processing', processing_token = v_token,
      lease_expires_at = now() + interval '5 minutes', attempts = attempts + 1,
      updated_at = now(), last_error = NULL
  WHERE event_id = p_event_id;
  RETURN jsonb_build_object('claimed', true, 'processing_token', v_token);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_stripe_webhook_event(text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_stripe_webhook_event(text,text,text) TO service_role;
