CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_role text;
  v_verification_status text;
  v_music_prefs text[];
BEGIN
  BEGIN
    v_role := COALESCE(NEW.raw_user_meta_data->>'role', 'attendee');
    IF v_role = 'organizer' THEN
      v_verification_status := 'pending_verification';
    ELSE
      v_verification_status := NULL;
    END IF;

    v_music_prefs := CASE
      WHEN jsonb_typeof(NEW.raw_user_meta_data->'music_preferences') = 'array'
        THEN ARRAY(SELECT jsonb_array_elements_text(NEW.raw_user_meta_data->'music_preferences'))
      ELSE ARRAY[]::text[]
    END;

    BEGIN
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
        v_music_prefs,
        v_verification_status
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
        updated_at = now();
    EXCEPTION
      WHEN undefined_column OR undefined_table THEN
        INSERT INTO public.profiles (id, full_name, email, avatar_url)
        VALUES (
          NEW.id,
          COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
          NEW.email,
          NEW.raw_user_meta_data->>'avatar_url'
        )
        ON CONFLICT (id) DO UPDATE SET
          full_name = EXCLUDED.full_name,
          email = EXCLUDED.email,
          avatar_url = EXCLUDED.avatar_url,
          updated_at = now();
      WHEN OTHERS THEN
        INSERT INTO public.profiles (id, full_name, email, avatar_url)
        VALUES (
          NEW.id,
          COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
          NEW.email,
          NEW.raw_user_meta_data->>'avatar_url'
        )
        ON CONFLICT (id) DO NOTHING;
    END;

    BEGIN
      INSERT INTO public.wallets (user_id, balance)
      VALUES (NEW.id, 0)
      ON CONFLICT (user_id) DO NOTHING;
    EXCEPTION
      WHEN OTHERS THEN
        NULL;
    END;

    RETURN NEW;
  EXCEPTION
    WHEN OTHERS THEN
      RETURN NEW;
  END;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();

NOTIFY pgrst, 'reload schema';

