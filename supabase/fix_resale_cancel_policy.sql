-- Script para arreglar permisos de cancelación de reventa
-- Este script asegura que los usuarios puedan eliminar sus ventas y actualizar sus tickets

-- 1. Habilitar RLS (por si acaso)
ALTER TABLE public.resale_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;

-- 2. Permiso para ELIMINAR sus propios anuncios de reventa
DROP POLICY IF EXISTS "Users can delete their own resale listings" ON public.resale_listings;
CREATE POLICY "Users can delete their own resale listings"
ON public.resale_listings
FOR DELETE
USING (auth.uid() = seller_id);

-- 3. Permiso para ACTUALIZAR sus propios tickets (necesario para cambiar estado a 'valid')
DROP POLICY IF EXISTS "Users can update their own tickets" ON public.tickets;
CREATE POLICY "Users can update their own tickets"
ON public.tickets
FOR UPDATE
USING (auth.uid() = user_id);

-- 4. Permiso para VER sus propios tickets
DROP POLICY IF EXISTS "Users can view their own tickets" ON public.tickets;
CREATE POLICY "Users can view their own tickets"
ON public.tickets
FOR SELECT
USING (auth.uid() = user_id);

-- 5. Permiso para VER sus propios anuncios de reventa
DROP POLICY IF EXISTS "Users can view their own resale listings" ON public.resale_listings;
CREATE POLICY "Users can view their own resale listings"
ON public.resale_listings
FOR SELECT
USING (auth.uid() = seller_id);

-- 6. Grant explícito
GRANT ALL ON public.resale_listings TO authenticated;
GRANT ALL ON public.tickets TO authenticated;

-- Confirmación
SELECT 'Permisos actualizados correctamente' as status;
