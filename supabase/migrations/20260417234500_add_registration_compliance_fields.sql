ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS accepted_terms_ip inet,
ADD COLUMN IF NOT EXISTS accepted_privacy_ip inet,
ADD COLUMN IF NOT EXISTS accepted_terms_user_agent text,
ADD COLUMN IF NOT EXISTS accepted_privacy_user_agent text,
ADD COLUMN IF NOT EXISTS phone_verified_at timestamptz,
ADD COLUMN IF NOT EXISTS phone_e164 text,
ADD COLUMN IF NOT EXISTS organizer_responsible_name text,
ADD COLUMN IF NOT EXISTS organizer_responsible_birthdate date,
ADD COLUMN IF NOT EXISTS organizer_fiscal_address text,
ADD COLUMN IF NOT EXISTS organizer_postal_code text,
ADD COLUMN IF NOT EXISTS organizer_iban text,
ADD COLUMN IF NOT EXISTS organizer_licenses_declared_at timestamptz,
ADD COLUMN IF NOT EXISTS organizer_venue_address text;

NOTIFY pgrst, 'reload schema';
