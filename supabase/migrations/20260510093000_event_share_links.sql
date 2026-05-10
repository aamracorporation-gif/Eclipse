CREATE TABLE IF NOT EXISTS public.event_share_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  token uuid NOT NULL DEFAULT gen_random_uuid(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  click_count integer NOT NULL DEFAULT 0,
  last_clicked_at timestamptz,
  conversion_count integer NOT NULL DEFAULT 0,
  last_converted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_event_share_links_token
ON public.event_share_links(token);

CREATE INDEX IF NOT EXISTS idx_event_share_links_event_active
ON public.event_share_links(event_id, is_active)
WHERE is_active = true;

CREATE TABLE IF NOT EXISTS public.event_share_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_link_id uuid REFERENCES public.event_share_links(id) ON DELETE SET NULL,
  event_id uuid REFERENCES public.events(id) ON DELETE CASCADE,
  token uuid,
  platform text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_share_clicks_event_created_at
ON public.event_share_clicks(event_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.event_share_conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_link_id uuid REFERENCES public.event_share_links(id) ON DELETE SET NULL,
  event_id uuid REFERENCES public.events(id) ON DELETE CASCADE,
  token uuid,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_share_conversions_event_created_at
ON public.event_share_conversions(event_id, created_at DESC);

ALTER TABLE public.event_share_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_share_clicks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_share_conversions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "No direct access to event_share_links" ON public.event_share_links;
CREATE POLICY "No direct access to event_share_links"
ON public.event_share_links
FOR ALL
TO public
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS "No direct access to event_share_clicks" ON public.event_share_clicks;
CREATE POLICY "No direct access to event_share_clicks"
ON public.event_share_clicks
FOR ALL
TO public
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS "No direct access to event_share_conversions" ON public.event_share_conversions;
CREATE POLICY "No direct access to event_share_conversions"
ON public.event_share_conversions
FOR ALL
TO public
USING (false)
WITH CHECK (false);

NOTIFY pgrst, 'reload schema';
