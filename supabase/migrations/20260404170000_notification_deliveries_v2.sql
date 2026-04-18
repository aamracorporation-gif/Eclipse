ALTER TABLE public.notification_settings
  ADD COLUMN IF NOT EXISTS push_enabled boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_enabled boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS sms_enabled boolean DEFAULT true;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS channels text[] DEFAULT ARRAY['in_app','push']::text[];

CREATE TABLE IF NOT EXISTS public.notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('push','email','sms')),
  status text NOT NULL CHECK (status IN ('pending','sent','failed','skipped')) DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  to_address text,
  provider text,
  provider_message_id text,
  last_error text,
  response jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  sent_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_deliveries_unique ON public.notification_deliveries(notification_id, channel);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_pending ON public.notification_deliveries(channel, status, created_at);

ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='notification_deliveries' AND policyname='Users can view own notification deliveries'
  ) THEN
    CREATE POLICY "Users can view own notification deliveries"
    ON public.notification_deliveries
    FOR SELECT
    TO authenticated
    USING (
      EXISTS (
        SELECT 1
        FROM public.notifications n
        WHERE n.id = notification_deliveries.notification_id
          AND n.user_id = auth.uid()
      )
    );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.create_notification_deliveries()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_channel text;
  v_channels text[];
BEGIN
  v_channels := COALESCE(NEW.channels, ARRAY['in_app','push']::text[]);

  FOREACH v_channel IN ARRAY v_channels LOOP
    IF v_channel IN ('push','email','sms') THEN
      INSERT INTO public.notification_deliveries(notification_id, channel, status)
      VALUES (NEW.id, v_channel, 'pending')
      ON CONFLICT (notification_id, channel) DO NOTHING;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_notification_deliveries ON public.notifications;
CREATE TRIGGER trg_create_notification_deliveries
AFTER INSERT ON public.notifications
FOR EACH ROW
EXECUTE FUNCTION public.create_notification_deliveries();

CREATE OR REPLACE FUNCTION public.sync_notification_status_from_deliveries()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total int;
  v_done int;
  v_sent int;
  v_last_error text;
BEGIN
  UPDATE public.notification_deliveries
  SET updated_at = now()
  WHERE id = NEW.id;

  SELECT count(*) INTO v_total
  FROM public.notification_deliveries d
  WHERE d.notification_id = NEW.notification_id;

  SELECT count(*) INTO v_done
  FROM public.notification_deliveries d
  WHERE d.notification_id = NEW.notification_id
    AND d.status IN ('sent','failed','skipped');

  SELECT count(*) INTO v_sent
  FROM public.notification_deliveries d
  WHERE d.notification_id = NEW.notification_id
    AND d.status = 'sent';

  SELECT d.last_error INTO v_last_error
  FROM public.notification_deliveries d
  WHERE d.notification_id = NEW.notification_id
    AND d.status = 'failed'
    AND d.last_error IS NOT NULL
  ORDER BY d.updated_at DESC
  LIMIT 1;

  IF v_total > 0 AND v_done = v_total THEN
    IF v_sent > 0 THEN
      UPDATE public.notifications
      SET status = 'sent',
          sent_at = COALESCE(sent_at, now()),
          error_message = NULL
      WHERE id = NEW.notification_id;
    ELSE
      UPDATE public.notifications
      SET status = 'failed',
          sent_at = COALESCE(sent_at, now()),
          error_message = COALESCE(v_last_error, 'all_channels_failed')
      WHERE id = NEW.notification_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_notification_status_from_deliveries ON public.notification_deliveries;
CREATE TRIGGER trg_sync_notification_status_from_deliveries
AFTER UPDATE OF status ON public.notification_deliveries
FOR EACH ROW
EXECUTE FUNCTION public.sync_notification_status_from_deliveries();

NOTIFY pgrst, 'reload schema';
