
-- Update profiles with legal/Stripe fields
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS legal_name text,
ADD COLUMN IF NOT EXISTS tax_id_number text,
ADD COLUMN IF NOT EXISTS business_type text;

-- Function to handle new user (creates Profile AND Wallet automatically)
-- Now includes role and Stripe Connect data for organizers
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_role text;
BEGIN
  v_role := COALESCE(NEW.raw_user_meta_data->>'role', 'attendee');

  -- Create Profile
  INSERT INTO public.profiles (
    id, 
    full_name, 
    email, 
    avatar_url, 
    role,
    club_name,
    address,
    instagram_account,
    business_email,
    phone,
    first_name,
    last_name,
    age,
    city,
    country,
    music_preferences,
    legal_name,
    tax_id_number,
    business_type,
    verification_status
  )
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.email,
    NEW.raw_user_meta_data->>'avatar_url',
    v_role,
    NEW.raw_user_meta_data->>'club_name',
    NEW.raw_user_meta_data->>'address',
    NEW.raw_user_meta_data->>'instagram_account',
    NEW.raw_user_meta_data->>'business_email',
    NEW.raw_user_meta_data->>'phone',
    NEW.raw_user_meta_data->>'first_name',
    NEW.raw_user_meta_data->>'last_name',
    (NEW.raw_user_meta_data->>'age')::int,
    NEW.raw_user_meta_data->>'city',
    NEW.raw_user_meta_data->>'country',
    ARRAY(SELECT jsonb_array_elements_text(NEW.raw_user_meta_data->'music_preferences')),
    NEW.raw_user_meta_data->>'legal_name',
    NEW.raw_user_meta_data->>'tax_id_number',
    NEW.raw_user_meta_data->>'business_type',
    CASE WHEN v_role = 'organizer' THEN 'pending_verification' ELSE NULL END
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    role = EXCLUDED.role,
    club_name = EXCLUDED.club_name,
    legal_name = EXCLUDED.legal_name,
    tax_id_number = EXCLUDED.tax_id_number,
    business_type = EXCLUDED.business_type;

  -- Create Wallet (ensure it exists)
  INSERT INTO public.wallets (user_id, balance)
  VALUES (NEW.id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Note: In a real environment, you'd also want an Edge Function to call Stripe's API
-- to create the connected account. Since we can't run Edge Functions from SQL easily,
-- we'll rely on the app detecting the missing stripe_account_id and calling createStripeConnectAccount().

NOTIFY pgrst, 'reload schema';
