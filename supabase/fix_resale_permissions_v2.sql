-- ==============================================================================
-- SCRIPT DE REPARACIÓN DE PERMISOS DE REVENTA
-- Ejecuta esto para ver tus entradas en venta/vendidas
-- ==============================================================================

-- 1. Asegurar que la tabla resale_listings existe
CREATE TABLE IF NOT EXISTS public.resale_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid REFERENCES public.tickets(id) ON DELETE CASCADE NOT NULL UNIQUE,
  seller_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  price numeric NOT NULL CHECK (price > 0),
  status text DEFAULT 'active' CHECK (status IN ('active', 'sold', 'cancelled')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2. Habilitar RLS en resale_listings
ALTER TABLE public.resale_listings ENABLE ROW LEVEL SECURITY;

-- 3. Política: Vendedores pueden ver TODAS sus publicaciones (activas, vendidas, canceladas)
DROP POLICY IF EXISTS "Users can view their own listings" ON public.resale_listings;
CREATE POLICY "Users can view their own listings"
  ON public.resale_listings FOR SELECT
  TO authenticated
  USING (auth.uid() = seller_id);

-- 4. Política: Vendedores pueden crear publicaciones
DROP POLICY IF EXISTS "Users can create resale listings for their tickets" ON public.resale_listings;
CREATE POLICY "Users can create resale listings for their tickets"
  ON public.resale_listings FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = seller_id AND
    EXISTS (SELECT 1 FROM tickets WHERE id = ticket_id AND user_id = auth.uid())
  );

-- 5. Política: Vendedores pueden borrar/cancelar sus publicaciones
DROP POLICY IF EXISTS "Users can delete their own listings" ON public.resale_listings;
CREATE POLICY "Users can delete their own listings"
  ON public.resale_listings FOR DELETE
  TO authenticated
  USING (auth.uid() = seller_id);

-- 6. CRÍTICO: Permitir ver el TICKET asociado aunque se haya vendido
-- Cuando vendes una entrada, el dueño (user_id) cambia al comprador.
-- Por defecto, no podrías ver la entrada antigua. Esta política lo arregla.
DROP POLICY IF EXISTS "Sellers can view tickets they listed" ON public.tickets;
CREATE POLICY "Sellers can view tickets they listed"
  ON public.tickets FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM resale_listings 
      WHERE resale_listings.ticket_id = tickets.id 
      AND resale_listings.seller_id = auth.uid()
    )
  );

-- 7. Asegurar que los tickets son visibles si eres el dueño actual
DROP POLICY IF EXISTS "Users can view own tickets" ON public.tickets;
CREATE POLICY "Users can view own tickets"
  ON public.tickets FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- 8. Asegurar que los eventos son públicos
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view events" ON public.events;
CREATE POLICY "Anyone can view events" ON public.events FOR SELECT USING (true);
