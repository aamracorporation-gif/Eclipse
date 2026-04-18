-- ==============================================================================
-- SCRIPT DE REPARACIÓN Y GARANTÍA DE CREACIÓN DE PERFILES
-- Ejecuta este script en el Editor SQL de Supabase para arreglar el registro.
-- ==============================================================================

-- 1. Asegurar que la tabla profiles existe y tiene permisos correctos
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  full_name text,
  email text,
  avatar_url text,
  role text DEFAULT 'user',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Habilitar RLS (Seguridad a nivel de fila)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 2. Asegurar que la tabla wallets existe
CREATE TABLE IF NOT EXISTS public.wallets (
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE PRIMARY KEY,
  balance decimal(10,2) DEFAULT 0.00,
  currency text DEFAULT 'EUR',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;

-- 3. Crear Políticas de Seguridad (RLS) Permisivas para INSERCIÓN
-- Esto permite que el usuario autenticado inserte su propio perfil
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile" 
ON public.profiles FOR INSERT 
WITH CHECK (auth.uid() = id);

-- Permisos de lectura/escritura básicos
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
CREATE POLICY "Public profiles are viewable by everyone" 
ON public.profiles FOR SELECT 
USING (true);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" 
ON public.profiles FOR UPDATE 
USING (auth.uid() = id);

-- 4. FUNCIÓN AUTOMÁTICA (Trigger) - La red de seguridad definitiva
-- Esta función se ejecuta CADA VEZ que se crea un usuario en auth.users
-- y crea automáticamente el perfil y la wallet, saltándose las restricciones RLS.
CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS trigger AS $$
BEGIN
  -- Insertar Perfil
  INSERT INTO public.profiles (id, full_name, email, role, avatar_url)
  VALUES (
    new.id, 
    COALESCE(new.raw_user_meta_data->>'full_name', new.email),
    new.email,
    COALESCE(new.raw_user_meta_data->>'role', 'user'),
    null
  )
  ON CONFLICT (id) DO UPDATE
  SET full_name = EXCLUDED.full_name,
      email = EXCLUDED.email;

  -- Insertar Wallet
  INSERT INTO public.wallets (user_id, balance, currency)
  VALUES (new.id, 0.00, 'EUR')
  ON CONFLICT (user_id) DO NOTHING;

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER; -- SECURITY DEFINER es clave: corre como admin

-- 5. Recrear el Trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 6. Reparar usuarios antiguos (Backfill)
-- Si tienes usuarios registrados que no tienen perfil, esto los crea ahora mismo.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT * FROM auth.users LOOP
    -- Intentar crear perfil si no existe
    INSERT INTO public.profiles (id, full_name, email)
    VALUES (r.id, COALESCE(r.raw_user_meta_data->>'full_name', r.email), r.email)
    ON CONFLICT (id) DO NOTHING;
    
    -- Intentar crear wallet si no existe
    INSERT INTO public.wallets (user_id, balance)
    VALUES (r.id, 0)
    ON CONFLICT (user_id) DO NOTHING;
  END LOOP;
END $$;
