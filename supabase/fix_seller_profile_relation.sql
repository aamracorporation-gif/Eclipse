-- ==============================================================================
-- SCRIPT PARA MOSTRAR EL NOMBRE DEL VENDEDOR
-- Ejecuta esto para permitir que la app obtenga el nombre del usuario que vende la entrada
-- ==============================================================================

-- 1. Añadir clave foránea explícita a la tabla profiles
-- Esto permite hacer el "join" en la consulta de Supabase: .select('..., seller:profiles(...)')
DO $$
BEGIN
  -- Intentar eliminar la restricción si ya existe (para evitar errores al re-ejecutar)
  BEGIN
    ALTER TABLE public.resale_listings DROP CONSTRAINT IF EXISTS resale_listings_seller_id_fkey_profiles;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  -- Añadir la restricción
  ALTER TABLE public.resale_listings
  ADD CONSTRAINT resale_listings_seller_id_fkey_profiles
  FOREIGN KEY (seller_id) REFERENCES public.profiles(id);
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Error al añadir la clave foránea (puede que la tabla profiles no exista o tenga otro nombre)';
END $$;

-- 2. Asegurar que los perfiles sean públicos (para ver el nombre)
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
CREATE POLICY "Public profiles are viewable by everyone" ON public.profiles FOR SELECT USING (true);

-- 3. Recargar esquema
NOTIFY pgrst, 'reload schema';
