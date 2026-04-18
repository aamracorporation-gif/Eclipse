CREATE TABLE IF NOT EXISTS public.event_live_metrics (
  event_id uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  checkins_count integer NOT NULL DEFAULT 0 CHECK (checkins_count >= 0),
  reports_count integer NOT NULL DEFAULT 0 CHECK (reports_count >= 0),
  live_viewers integer NOT NULL DEFAULT 0 CHECK (live_viewers >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.event_live_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read live metrics" ON public.event_live_metrics;
CREATE POLICY "Anyone can read live metrics"
ON public.event_live_metrics
FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Admins can update live metrics" ON public.event_live_metrics;
CREATE POLICY "Admins can update live metrics"
ON public.event_live_metrics
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'admin'
  )
);

CREATE TABLE IF NOT EXISTS public.event_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id)
);

ALTER TABLE public.event_checkins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their own checkins" ON public.event_checkins;
CREATE POLICY "Users can read their own checkins"
ON public.event_checkins
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can check in" ON public.event_checkins;
CREATE POLICY "Users can check in"
ON public.event_checkins
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.event_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  level integer NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 3),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.event_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can create reports" ON public.event_reports;
CREATE POLICY "Users can create reports"
ON public.event_reports
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can read their own reports" ON public.event_reports;
CREATE POLICY "Users can read their own reports"
ON public.event_reports
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_event_checkins_event_id ON public.event_checkins(event_id);
CREATE INDEX IF NOT EXISTS idx_event_reports_event_id ON public.event_reports(event_id);

CREATE OR REPLACE FUNCTION public.upsert_event_live_metrics(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.event_live_metrics (event_id, checkins_count, reports_count, live_viewers, updated_at)
  VALUES (p_event_id, 0, 0, 0, now())
  ON CONFLICT (event_id) DO UPDATE
  SET updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.bump_metrics_from_checkin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM public.upsert_event_live_metrics(NEW.event_id);
  UPDATE public.event_live_metrics
  SET checkins_count = checkins_count + 1,
      updated_at = now()
  WHERE event_id = NEW.event_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_event_checkins_metrics ON public.event_checkins;
CREATE TRIGGER trg_event_checkins_metrics
AFTER INSERT ON public.event_checkins
FOR EACH ROW
EXECUTE FUNCTION public.bump_metrics_from_checkin();

CREATE OR REPLACE FUNCTION public.bump_metrics_from_report()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM public.upsert_event_live_metrics(NEW.event_id);
  UPDATE public.event_live_metrics
  SET reports_count = reports_count + 1,
      updated_at = now()
  WHERE event_id = NEW.event_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_event_reports_metrics ON public.event_reports;
CREATE TRIGGER trg_event_reports_metrics
AFTER INSERT ON public.event_reports
FOR EACH ROW
EXECUTE FUNCTION public.bump_metrics_from_report();

CREATE OR REPLACE FUNCTION public.adjust_event_live_viewers(p_event_id uuid, p_delta integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_next integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM public.upsert_event_live_metrics(p_event_id);

  UPDATE public.event_live_metrics
  SET live_viewers = GREATEST(0, live_viewers + p_delta),
      updated_at = now()
  WHERE event_id = p_event_id
  RETURNING live_viewers INTO v_next;

  RETURN jsonb_build_object('event_id', p_event_id, 'live_viewers', v_next);
END;
$$;
