-- Security hardening: prevent self-assigned admin role via signup metadata

-- 1) Do not allow users to INSERT profiles with role='admin'
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile"
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = id
  AND (
    role IS NULL
    OR role IN ('attendee', 'organizer')
  )
);

-- 2) Harden handle_new_user: only allow attendee/organizer from signup metadata (never admin)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_role text;
  v_verification_status text;
  v_admin_email text := 'aamracorporation@gmail.com';
BEGIN
  v_role := lower(COALESCE(NEW.raw_user_meta_data->>'role', 'attendee'));

  IF v_role NOT IN ('attendee', 'organizer') THEN
    v_role := 'attendee';
  END IF;

  IF lower(COALESCE(NEW.email, '')) = lower(v_admin_email) THEN
    v_role := 'admin';
  END IF;

  IF v_role = 'organizer' THEN
    v_verification_status := 'pending_verification';
  ELSE
    v_verification_status := NULL;
  END IF;

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
    verification_status
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
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
    CAST(NULLIF(NEW.raw_user_meta_data->>'age', '') AS INTEGER),
    NEW.raw_user_meta_data->>'gender',
    NEW.raw_user_meta_data->>'city',
    NEW.raw_user_meta_data->>'country',
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(NEW.raw_user_meta_data->'music_preferences', '[]'::jsonb))),
    v_verification_status
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    avatar_url = EXCLUDED.avatar_url,
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
    role = CASE
      WHEN lower(COALESCE(EXCLUDED.email, '')) = lower(v_admin_email) THEN 'admin'
      ELSE COALESCE(public.profiles.role, EXCLUDED.role)
    END,
    verification_status = CASE
      WHEN lower(COALESCE(EXCLUDED.email, '')) = lower(v_admin_email) THEN NULL
      ELSE COALESCE(public.profiles.verification_status, EXCLUDED.verification_status)
    END,
    updated_at = now();

  INSERT INTO public.wallets (user_id, balance)
  VALUES (NEW.id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- 3) Force the only admin account by email. Demote any other accidental admins.
DO $$
DECLARE
  v_admin_email text := 'aamracorporation@gmail.com';
  v_keep_admin uuid;
BEGIN
  SELECT id
  INTO v_keep_admin
  FROM public.profiles
  WHERE lower(email) = lower(v_admin_email)
  LIMIT 1;

  IF v_keep_admin IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.profiles
  SET
    role = 'admin',
    verification_status = NULL,
    verification_rejection_reason = NULL,
    verification_reviewed_at = NULL,
    verification_reviewed_by = NULL,
    updated_at = now()
  WHERE id = v_keep_admin;

  UPDATE public.profiles p
  SET
    role = CASE
      WHEN COALESCE(p.club_name, '') <> '' OR COALESCE(p.business_email, '') <> '' OR COALESCE(p.instagram_account, '') <> '' THEN 'organizer'
      ELSE 'attendee'
    END,
    verification_status = CASE
      WHEN COALESCE(p.club_name, '') <> '' OR COALESCE(p.business_email, '') <> '' OR COALESCE(p.instagram_account, '') <> '' THEN COALESCE(p.verification_status, 'pending_verification')
      ELSE NULL
    END,
    verification_rejection_reason = NULL,
    verification_reviewed_at = NULL,
    verification_reviewed_by = NULL,
    updated_at = now()
  WHERE p.role = 'admin'
    AND p.id <> v_keep_admin;
END $$;

NOTIFY pgrst, 'reload schema';
