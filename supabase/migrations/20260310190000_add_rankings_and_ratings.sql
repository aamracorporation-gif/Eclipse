CREATE TABLE IF NOT EXISTS public.event_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id)
);

ALTER TABLE public.event_ratings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read event ratings" ON public.event_ratings;
CREATE POLICY "Anyone can read event ratings"
ON public.event_ratings
FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Users can rate events" ON public.event_ratings;
CREATE POLICY "Users can rate events"
ON public.event_ratings
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their rating" ON public.event_ratings;
CREATE POLICY "Users can update their rating"
ON public.event_ratings
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their rating" ON public.event_ratings;
CREATE POLICY "Users can delete their rating"
ON public.event_ratings
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.get_event_rankings(
  p_range text,
  p_lat numeric DEFAULT NULL,
  p_lng numeric DEFAULT NULL,
  p_radius_km numeric DEFAULT 25
)
RETURNS TABLE (
  event_id uuid,
  title text,
  club_name text,
  poster_url text,
  venue_name text,
  event_date timestamptz,
  sold_tickets integer,
  checkins_count integer,
  live_viewers integer,
  engagement_count integer,
  avg_rating numeric,
  score numeric,
  trending boolean,
  distance_km numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_start timestamptz;
  v_end timestamptz;
  v_nearby boolean := false;
  v_lat numeric := p_lat;
  v_lng numeric := p_lng;
BEGIN
  IF p_range = 'tonight' THEN
    v_start := date_trunc('day', now());
    v_end := v_start + interval '1 day';
  ELSIF p_range = 'month' THEN
    v_start := date_trunc('month', now());
    v_end := v_start + interval '1 month';
  ELSIF p_range = 'nearby' THEN
    v_nearby := true;
    v_start := date_trunc('week', now());
    v_end := v_start + interval '1 week';
  ELSE
    v_start := date_trunc('week', now());
    v_end := v_start + interval '1 week';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      e.id AS event_id,
      e.title,
      COALESCE(p.club_name, 'Club') AS club_name,
      COALESCE(e.poster_url, '') AS poster_url,
      COALESCE(v.name, '') AS venue_name,
      e.event_date,
      COALESCE(e.sold_tickets, 0) AS sold_tickets,
      COALESCE(m.checkins_count, 0) AS checkins_count,
      COALESCE(m.live_viewers, 0) AS live_viewers,
      COALESCE(eng.engagement_count, 0) AS engagement_count,
      COALESCE(r.avg_rating, NULL) AS avg_rating,
      v.latitude::numeric AS venue_lat,
      v.longitude::numeric AS venue_lng
    FROM public.events e
    LEFT JOIN public.venues v ON v.id = e.venue_id
    LEFT JOIN public.profiles p ON p.id = e.creator_id
    LEFT JOIN public.event_live_metrics m ON m.event_id = e.id
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS engagement_count
      FROM public.event_media em
      JOIN public.event_media_engagement eme ON eme.media_id = em.id
      WHERE em.event_id = e.id
    ) eng ON true
    LEFT JOIN LATERAL (
      SELECT AVG(er.rating)::numeric AS avg_rating
      FROM public.event_ratings er
      WHERE er.event_id = e.id
    ) r ON true
    WHERE e.event_date >= v_start AND e.event_date < v_end
  ),
  scored AS (
    SELECT
      b.*,
      (
        (b.sold_tickets::numeric * 1.2) +
        (b.checkins_count::numeric * 2.0) +
        (b.live_viewers::numeric * 0.4) +
        (b.engagement_count::numeric * 0.2) +
        (COALESCE(b.avg_rating, 0)::numeric * 10.0)
      ) AS score,
      (
        b.engagement_count >= 30 OR b.live_viewers >= 60 OR b.checkins_count >= 60
      ) AS trending,
      CASE
        WHEN v_nearby AND v_lat IS NOT NULL AND v_lng IS NOT NULL AND b.venue_lat IS NOT NULL AND b.venue_lng IS NOT NULL THEN
          6371 * 2 * asin(sqrt(
            pow(sin(radians((b.venue_lat - v_lat) / 2)), 2) +
            cos(radians(v_lat)) * cos(radians(b.venue_lat)) * pow(sin(radians((b.venue_lng - v_lng) / 2)), 2)
          ))
        ELSE NULL
      END AS distance_km
    FROM base b
  )
  SELECT
    s.event_id,
    s.title,
    s.club_name,
    s.poster_url,
    s.venue_name,
    s.event_date,
    s.sold_tickets,
    s.checkins_count,
    s.live_viewers,
    s.engagement_count,
    s.avg_rating,
    s.score,
    s.trending,
    s.distance_km
  FROM scored s
  WHERE NOT v_nearby
     OR (s.distance_km IS NOT NULL AND s.distance_km <= p_radius_km)
  ORDER BY
    CASE WHEN v_nearby THEN s.distance_km END ASC NULLS LAST,
    s.score DESC
  LIMIT 50;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_club_rankings(
  p_range text,
  p_lat numeric DEFAULT NULL,
  p_lng numeric DEFAULT NULL,
  p_radius_km numeric DEFAULT 25
)
RETURNS TABLE (
  organizer_id uuid,
  club_name text,
  avatar_url text,
  events_count integer,
  avg_rating numeric,
  score numeric,
  trending boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_start timestamptz;
  v_end timestamptz;
  v_nearby boolean := false;
BEGIN
  IF p_range = 'tonight' THEN
    v_start := date_trunc('day', now());
    v_end := v_start + interval '1 day';
  ELSIF p_range = 'month' THEN
    v_start := date_trunc('month', now());
    v_end := v_start + interval '1 month';
  ELSIF p_range = 'nearby' THEN
    v_nearby := true;
    v_start := date_trunc('week', now());
    v_end := v_start + interval '1 week';
  ELSE
    v_start := date_trunc('week', now());
    v_end := v_start + interval '1 week';
  END IF;

  RETURN QUERY
  WITH er AS (
    SELECT
      e.creator_id,
      COUNT(*)::int AS events_count,
      SUM(COALESCE(e.sold_tickets, 0))::numeric AS sold_sum
    FROM public.events e
    WHERE e.event_date >= v_start AND e.event_date < v_end
    GROUP BY e.creator_id
  ),
  metrics AS (
    SELECT
      e.creator_id,
      SUM(COALESCE(m.checkins_count, 0))::numeric AS checkins_sum,
      SUM(COALESCE(m.live_viewers, 0))::numeric AS viewers_sum
    FROM public.events e
    LEFT JOIN public.event_live_metrics m ON m.event_id = e.id
    WHERE e.event_date >= v_start AND e.event_date < v_end
    GROUP BY e.creator_id
  ),
  engagement AS (
    SELECT
      e.creator_id,
      COUNT(eme.id)::numeric AS engagement_sum
    FROM public.events e
    JOIN public.event_media em ON em.event_id = e.id
    JOIN public.event_media_engagement eme ON eme.media_id = em.id
    WHERE e.event_date >= v_start AND e.event_date < v_end
    GROUP BY e.creator_id
  ),
  ratings AS (
    SELECT
      e.creator_id,
      AVG(r.rating)::numeric AS avg_rating
    FROM public.events e
    JOIN public.event_ratings r ON r.event_id = e.id
    WHERE e.event_date >= v_start AND e.event_date < v_end
    GROUP BY e.creator_id
  ),
  nearby_creators AS (
    SELECT DISTINCT e.creator_id
    FROM public.events e
    JOIN public.venues v ON v.id = e.venue_id
    WHERE v_nearby
      AND p_lat IS NOT NULL
      AND p_lng IS NOT NULL
      AND e.event_date >= v_start AND e.event_date < v_end
      AND 6371 * 2 * asin(sqrt(
        pow(sin(radians(((v.latitude::numeric) - p_lat) / 2)), 2) +
        cos(radians(p_lat)) * cos(radians(v.latitude::numeric)) * pow(sin(radians(((v.longitude::numeric) - p_lng) / 2)), 2)
      )) <= p_radius_km
  )
  SELECT
    p.id AS organizer_id,
    COALESCE(p.club_name, 'Club') AS club_name,
    COALESCE(p.avatar_url, '') AS avatar_url,
    COALESCE(er.events_count, 0) AS events_count,
    COALESCE(ratings.avg_rating, NULL) AS avg_rating,
    (
      (COALESCE(er.sold_sum, 0) * 1.2) +
      (COALESCE(metrics.checkins_sum, 0) * 2.0) +
      (COALESCE(metrics.viewers_sum, 0) * 0.4) +
      (COALESCE(engagement.engagement_sum, 0) * 0.2) +
      (COALESCE(ratings.avg_rating, 0) * 10.0)
    ) AS score,
    (
      COALESCE(engagement.engagement_sum, 0) >= 60 OR COALESCE(metrics.viewers_sum, 0) >= 120 OR COALESCE(metrics.checkins_sum, 0) >= 120
    ) AS trending
  FROM public.profiles p
  LEFT JOIN er ON er.creator_id = p.id
  LEFT JOIN metrics ON metrics.creator_id = p.id
  LEFT JOIN engagement ON engagement.creator_id = p.id
  LEFT JOIN ratings ON ratings.creator_id = p.id
  WHERE p.role = 'organizer'
    AND (NOT v_nearby OR p.id IN (SELECT creator_id FROM nearby_creators))
  ORDER BY score DESC
  LIMIT 50;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_event_ratings_event_id ON public.event_ratings(event_id);
CREATE INDEX IF NOT EXISTS idx_event_ratings_user_id ON public.event_ratings(user_id);

GRANT SELECT ON TABLE public.event_ratings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.event_ratings TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_event_rankings(text, numeric, numeric, numeric) TO anon;
GRANT EXECUTE ON FUNCTION public.get_event_rankings(text, numeric, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_club_rankings(text, numeric, numeric, numeric) TO anon;
GRANT EXECUTE ON FUNCTION public.get_club_rankings(text, numeric, numeric, numeric) TO authenticated;

NOTIFY pgrst, 'reload schema';
