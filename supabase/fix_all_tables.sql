-- ==============================================================================
-- SCRIPT DE REPARACIÓN MAESTRO (Fix All Tables)
-- Ejecuta esto para crear las tablas que faltan (profiles) y arreglar las relaciones
-- ==============================================================================

-- 1. Crear tabla PROFILES si no existe
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  full_name text,
  email text,
  avatar_url text,
  role text DEFAULT 'user',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2. Habilitar RLS para profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 3. Políticas de acceso para profiles (Público para ver nombres)
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
CREATE POLICY "Public profiles are viewable by everyone" ON public.profiles FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- 4. Crear tabla WALLETS si no existe (Depende de profiles)
CREATE TABLE IF NOT EXISTS public.wallets (
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE PRIMARY KEY,
  balance decimal(10,2) DEFAULT 0.00,
  currency text DEFAULT 'EUR',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 5. Habilitar RLS para wallets
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;

-- 6. Políticas de acceso para wallets
DROP POLICY IF EXISTS "Users can view own wallet" ON public.wallets;
CREATE POLICY "Users can view own wallet" ON public.wallets FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own wallet" ON public.wallets;
CREATE POLICY "Users can update own wallet" ON public.wallets FOR UPDATE USING (auth.uid() = user_id);

-- 7. REPARAR RELACIÓN EN RESALE_LISTINGS
-- Esto permitirá obtener el nombre del vendedor haciendo join con profiles
DO $$
BEGIN
  -- Primero intentamos borrar la constraint si existe (por si acaso)
  BEGIN
    ALTER TABLE public.resale_listings DROP CONSTRAINT IF EXISTS resale_listings_seller_id_fkey_profiles;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  -- Añadimos la constraint que vincula seller_id con profiles.id
  -- NOTA: seller_id ya es UUID y coincide con profiles.id
  ALTER TABLE public.resale_listings
  ADD CONSTRAINT resale_listings_seller_id_fkey_profiles
  FOREIGN KEY (seller_id) REFERENCES public.profiles(id);
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Error gestionando la clave foránea en resale_listings: %', SQLERRM;
END $$;

-- 8. AUTORREPARACIÓN DE PERFILES PERDIDOS
-- Si hay usuarios en auth.users que no tienen perfil en public.profiles, crearlos ahora
INSERT INTO public.profiles (id, email, full_name)
SELECT 
  id, 
  email, 
  COALESCE(raw_user_meta_data->>'full_name', email) as full_name
FROM auth.users
WHERE id NOT IN (SELECT id FROM public.profiles)
ON CONFLICT (id) DO NOTHING;

-- 9. AUTORREPARACIÓN DE WALLETS PERDIDAS
INSERT INTO public.wallets (user_id, balance)
SELECT id, 0.00
FROM public.profiles
WHERE id NOT IN (SELECT user_id FROM public.wallets)
ON CONFLICT (user_id) DO NOTHING;
