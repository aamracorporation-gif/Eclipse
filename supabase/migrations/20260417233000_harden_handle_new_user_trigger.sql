CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_role text;
  v_verification_status text;
  v_age int;
  v_music text[] := ARRAY[]::text[];
  v_accepted_terms_at timestamptz;
  v_accepted_privacy_at timestamptz;
BEGIN
  v_role := COALESCE(NEW.raw_user_meta_data->>'role', 'attendee');
  IF v_role NOT IN ('attendee', 'organizer', 'admin') THEN
    v_role := 'attendee';
  END IF;

  IF v_role = 'organizer' THEN
    v_verification_status := 'pending_verification';
  ELSE
    v_verification_status := NULL;
  END IF;

  v_age := NULL;
  IF COALESCE(NEW.raw_user_meta_data->>'age', '') ~ '^[0-9]+$' THEN
    v_age := (NEW.raw_user_meta_data->>'age')::int;
  END IF;

  IF jsonb_typeof(NEW.raw_user_meta_data->'music_preferences') = 'array' THEN
    SELECT COALESCE(array_agg(x), ARRAY[]::text[])
    INTO v_music
    FROM jsonb_array_elements_text(NEW.raw_user_meta_data->'music_preferences') AS x;
  END IF;

  BEGIN
    v_accepted_terms_at := NULLIF(COALESCE(NEW.raw_user_meta_data->>'accepted_terms_at', ''), '')::timestamptz;
  EXCEPTION WHEN others THEN
    v_accepted_terms_at := NULL;
  END;

  BEGIN
    v_accepted_privacy_at := NULLIF(COALESCE(NEW.raw_user_meta_data->>'accepted_privacy_at', ''), '')::timestamptz;
  EXCEPTION WHEN others THEN
    v_accepted_privacy_at := NULL;
  END;

  INSERT INTO public.profiles (
    id,
    email,
    full_name,
    avatar_url,
    role,
    club_name,
    address,
    phone,
    opening_hours,
    instagram_account,
    business_email,
    first_name,
    last_name,
    age,
    gender,
    city,
    country,
    music_preferences,
    verification_status,
    accepted_terms_at,
    accepted_privacy_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name', ''), NEW.email),
    NEW.raw_user_meta_data->>'avatar_url',
    v_role,
    NEW.raw_user_meta_data->>'club_name',
    NEW.raw_user_meta_data->>'address',
    NEW.raw_user_meta_data->>'phone',
    NEW.raw_user_meta_data->>'opening_hours',
    NEW.raw_user_meta_data->>'instagram_account',
    NEW.raw_user_meta_data->>'business_email',
    NEW.raw_user_meta_data->>'first_name',
    NEW.raw_user_meta_data->>'last_name',
    v_age,
    NEW.raw_user_meta_data->>'gender',
    NEW.raw_user_meta_data->>'city',
    NEW.raw_user_meta_data->>'country',
    v_music,
    v_verification_status,
    v_accepted_terms_at,
    v_accepted_privacy_at
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    avatar_url = EXCLUDED.avatar_url,
    role = EXCLUDED.role,
    club_name = EXCLUDED.club_name,
    address = EXCLUDED.address,
    phone = EXCLUDED.phone,
    opening_hours = EXCLUDED.opening_hours,
    instagram_account = EXCLUDED.instagram_account,
    business_email = EXCLUDED.business_email,
    first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    age = EXCLUDED.age,
    gender = EXCLUDED.gender,
    city = EXCLUDED.city,
    country = EXCLUDED.country,
    music_preferences = EXCLUDED.music_preferences,
    verification_status = COALESCE(public.profiles.verification_status, EXCLUDED.verification_status),
    accepted_terms_at = COALESCE(public.profiles.accepted_terms_at, EXCLUDED.accepted_terms_at),
    accepted_privacy_at = COALESCE(public.profiles.accepted_privacy_at, EXCLUDED.accepted_privacy_at),
    updated_at = now();

  RETURN NEW;
EXCEPTION
  WHEN others THEN
    -- Never block auth signup because of profile metadata parsing.
    INSERT INTO public.profiles (id, email, full_name, role, accepted_terms_at, accepted_privacy_at)
    VALUES (
      NEW.id,
      NEW.email,
      COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name', ''), NEW.email),
      'attendee',
      NULL,
      NULL
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';

