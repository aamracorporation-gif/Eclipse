-- ==============================================================================
-- SCRIPT: FORZAR NOMBRES EN PERFILES (Force Names)
-- Ejecuta esto para asegurar que todos los usuarios tengan un nombre visible
-- ==============================================================================

-- 1. Actualizar perfiles que tienen nombre nulo
UPDATE public.profiles
SET full_name = COALESCE(
  full_name, 
  split_part(email, '@', 1), 
  'Usuario'
)
WHERE full_name IS NULL OR full_name = '';

-- 2. Verificar si hay perfiles faltantes para los vendedores en resale_listings
-- Insertar perfiles placeholder si faltan (para evitar que la app falle)
INSERT INTO public.profiles (id, email, full_name)
SELECT 
  rl.seller_id, 
  'unknown@user.com', 
  'Vendedor Desconocido'
FROM public.resale_listings rl
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = rl.seller_id)
ON CONFLICT (id) DO NOTHING;

-- 3. Confirmar que la relación existe (redundante pero seguro)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'resale_listings_seller_id_fkey_profiles'
  ) THEN
    ALTER TABLE public.resale_listings
    ADD CONSTRAINT resale_listings_seller_id_fkey_profiles
    FOREIGN KEY (seller_id) REFERENCES public.profiles(id);
  END IF;
END $$;

-- 4. Recargar caché de esquema para asegurar que la API vea los cambios
NOTIFY pgrst, 'reload schema';
