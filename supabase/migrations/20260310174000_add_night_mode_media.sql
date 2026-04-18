CREATE TABLE IF NOT EXISTS public.event_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  uploader_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  media_type text NOT NULL DEFAULT 'clip' CHECK (media_type IN ('clip')),
  video_url text NOT NULL,
  thumbnail_url text DEFAULT '',
  duration_seconds integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.event_media ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read event media" ON public.event_media;
CREATE POLICY "Anyone can read event media"
ON public.event_media
FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Users can upload event media" ON public.event_media;
CREATE POLICY "Users can upload event media"
ON public.event_media
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = uploader_id);

DROP POLICY IF EXISTS "Users can delete their media" ON public.event_media;
CREATE POLICY "Users can delete their media"
ON public.event_media
FOR DELETE
TO authenticated
USING (auth.uid() = uploader_id);

CREATE TABLE IF NOT EXISTS public.event_live_streams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  organizer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stream_url text NOT NULL,
  status text NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'ended')),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);

ALTER TABLE public.event_live_streams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read live streams" ON public.event_live_streams;
CREATE POLICY "Anyone can read live streams"
ON public.event_live_streams
FOR SELECT
USING (status = 'live');

DROP POLICY IF EXISTS "Verified organizers can start streams" ON public.event_live_streams;
CREATE POLICY "Verified organizers can start streams"
ON public.event_live_streams
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = organizer_id
  AND EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = event_id
      AND e.creator_id = auth.uid()
  )
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'organizer'
      AND p.verification_status = 'verified'
  )
);

DROP POLICY IF EXISTS "Organizers can end their streams" ON public.event_live_streams;
CREATE POLICY "Organizers can end their streams"
ON public.event_live_streams
FOR UPDATE
TO authenticated
USING (auth.uid() = organizer_id)
WITH CHECK (auth.uid() = organizer_id);

CREATE TABLE IF NOT EXISTS public.event_media_engagement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  media_id uuid NOT NULL REFERENCES public.event_media(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('like', 'save', 'share')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (media_id, user_id, type)
);

ALTER TABLE public.event_media_engagement ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read engagement" ON public.event_media_engagement;
CREATE POLICY "Anyone can read engagement"
ON public.event_media_engagement
FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Users can engage" ON public.event_media_engagement;
CREATE POLICY "Users can engage"
ON public.event_media_engagement
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can undo their engagement" ON public.event_media_engagement;
CREATE POLICY "Users can undo their engagement"
ON public.event_media_engagement
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_event_media_event_id_created_at ON public.event_media(event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_live_streams_event_id_status ON public.event_live_streams(event_id, status);
CREATE INDEX IF NOT EXISTS idx_event_media_engagement_media_id ON public.event_media_engagement(media_id);

