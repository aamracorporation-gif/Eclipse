-- Enable pgcrypto for UUID and random bytes generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Fix Registration Trigger to respect Role
-- Ensure profiles table has music_preferences
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'music_preferences'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN music_preferences text[];
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url, role, club_name, phone, city, country, age, music_preferences)
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'full_name', new.email),
    new.raw_user_meta_data->>'avatar_url',
    COALESCE(new.raw_user_meta_data->>'role', 'attendee'),
    new.raw_user_meta_data->>'club_name',
    new.raw_user_meta_data->>'phone',
    new.raw_user_meta_data->>'city',
    new.raw_user_meta_data->>'country',
    NULLIF(new.raw_user_meta_data->>'age', '')::int,
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(new.raw_user_meta_data->'music_preferences', '[]'::jsonb)))
  );
  
  INSERT INTO public.wallets (user_id, balance)
  VALUES (new.id, 0);
  
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Ensure Trigger exists (re-create it to be safe)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Fix Ticket Visibility (RLS)
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own tickets" ON public.tickets;
CREATE POLICY "Users can view own tickets"
ON public.tickets
FOR SELECT
USING (auth.uid() = user_id);

-- Fix Resale Listings Visibility/Access
ALTER TABLE public.resale_listings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view active resale listings" ON public.resale_listings;
CREATE POLICY "Users can view active resale listings"
ON public.resale_listings
FOR SELECT
USING (status = 'active' OR auth.uid() = seller_id);

DROP POLICY IF EXISTS "Users can create resale listings" ON public.resale_listings;
CREATE POLICY "Users can create resale listings"
ON public.resale_listings
FOR INSERT
WITH CHECK (auth.uid() = seller_id);

DROP POLICY IF EXISTS "Users can delete own resale listings" ON public.resale_listings;
CREATE POLICY "Users can delete own resale listings"
ON public.resale_listings
FOR DELETE
USING (auth.uid() = seller_id);

-- Ensure users can update their own tickets (needed for some flows)
DROP POLICY IF EXISTS "Users can update own tickets" ON public.tickets;
CREATE POLICY "Users can update own tickets"
ON public.tickets
FOR UPDATE
USING (auth.uid() = user_id);

-- Auto-generate QR token if missing
CREATE OR REPLACE FUNCTION public.generate_ticket_qr_token()
RETURNS trigger AS $$
BEGIN
  IF new.qr_token IS NULL THEN
    new.qr_token := encode(gen_random_bytes(32), 'hex');
  END IF;
  RETURN new;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ensure_qr_token ON public.tickets;
CREATE TRIGGER ensure_qr_token
  BEFORE INSERT ON public.tickets
  FOR EACH ROW EXECUTE PROCEDURE public.generate_ticket_qr_token();

-- Backfill existing tickets with QR tokens if they are missing
UPDATE public.tickets SET qr_token = encode(gen_random_bytes(32), 'hex') WHERE qr_token IS NULL;

-- Grant permissions
GRANT ALL ON public.profiles TO authenticated;
GRANT ALL ON public.tickets TO authenticated;
GRANT ALL ON public.resale_listings TO authenticated;

-- 6. FIX EVENTS RELATIONSHIP (Fixes PGRST200 error)
-- Allow joining events with profiles via creator_id
DO $$
BEGIN
  -- Add FK to profiles if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'events_creator_id_fkey_profiles'
  ) THEN
    ALTER TABLE public.events
    ADD CONSTRAINT events_creator_id_fkey_profiles
    FOREIGN KEY (creator_id)
    REFERENCES public.profiles(id);
  END IF;
END $$;

-- 7. QR SECURITY SYSTEM
-- Add scanned_at column to tickets if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tickets' AND column_name = 'scanned_at'
  ) THEN
    ALTER TABLE public.tickets ADD COLUMN scanned_at TIMESTAMPTZ;
  END IF;
END $$;

-- RPC Function to validate ticket QR (V2)
-- Renamed to v2 to avoid any signature ambiguity or cache issues with previous versions
CREATE OR REPLACE FUNCTION public.validate_ticket_qr_v2(p_qr_token text, p_scanned_by_text text)
RETURNS jsonb AS $$
DECLARE
  v_ticket record;
  v_event record;
  v_user record;
  v_ticket_info jsonb;
  v_scanner_id uuid;
BEGIN
  -- Explicit cast to avoid "operator does not exist: uuid = text" errors
  BEGIN
    v_scanner_id := p_scanned_by_text::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('valid', false, 'message', 'ID de escáner inválido');
  END;

  -- Find ticket by token (Try UUID token first, then fallback to ID if needed)
  -- We cast columns to text to ensure comparison works regardless of column type
  SELECT * INTO v_ticket FROM public.tickets 
  WHERE qr_token::text = p_qr_token 
  OR id::text = p_qr_token 
  LIMIT 1;

  IF v_ticket IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'message', 'Entrada no encontrada');
  END IF;

  -- Get Event Info
  SELECT * INTO v_event FROM public.events WHERE id = v_ticket.event_id;
  
  -- Get User Info
  SELECT * INTO v_user FROM public.profiles WHERE id = v_ticket.user_id;

  -- Construct basic ticket info for display
  v_ticket_info := jsonb_build_object(
    'id', v_ticket.id,
    'event', v_event.title,
    'owner', v_user.full_name,
    'date', v_event.event_date,
    'scanned_at', v_ticket.scanned_at
  );

  -- 1. Check if the scanner is the organizer of the event
  IF v_event.creator_id != v_scanner_id THEN
    RETURN jsonb_build_object(
      'valid', false,
      'message', 'Esta entrada no pertenece a tus eventos',
      'ticket', v_ticket_info
    );
  END IF;

  -- 2. Check if already scanned
  IF v_ticket.scanned_at IS NOT NULL OR v_ticket.status = 'used' THEN
    RETURN jsonb_build_object(
      'valid', false, 
      'message', 'Entrada YA utilizada', 
      'ticket', v_ticket_info
    );
  END IF;

  -- 3. Mark as scanned
  UPDATE public.tickets SET scanned_at = NOW(), status = 'used' WHERE id = v_ticket.id;
  
  -- Return success
  RETURN jsonb_build_object(
    'valid', true,
    'message', 'Entrada Válida',
    'ticket', jsonb_build_object(
        'id', v_ticket.id,
        'event', v_event.title,
        'owner', v_user.full_name,
        'date', v_event.event_date,
        'scanned_at', NOW()
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Clean up old versions to avoid confusion (Optional but recommended)
DO $$
DECLARE
    func_record record;
BEGIN
    FOR func_record IN
        SELECT oid::regprocedure::text as func_signature
        FROM pg_proc
        WHERE proname = 'validate_ticket_qr' AND pronamespace = 'public'::regnamespace
    LOOP
        EXECUTE 'DROP FUNCTION IF EXISTS ' || func_record.func_signature || ' CASCADE';
    END LOOP;
END $$;

-- Reload schema cache to ensure changes are picked up
NOTIFY pgrst, 'reload config';
