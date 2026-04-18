-- ==============================================================================
-- SCRIPT DE REPARACIÓN DEFINITIVO (V3)
-- Instrucciones: Copia y pega TODO este contenido en el Editor SQL de Supabase y dale a RUN.
-- ==============================================================================

-- 1. Reparar tabla resale_listings (si no existe o tiene problemas)
CREATE TABLE IF NOT EXISTS public.resale_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid REFERENCES public.tickets(id) ON DELETE CASCADE NOT NULL UNIQUE,
  seller_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  price numeric NOT NULL CHECK (price > 0),
  status text DEFAULT 'active' CHECK (status IN ('active', 'sold', 'cancelled')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2. Habilitar seguridad (RLS)
ALTER TABLE public.resale_listings ENABLE ROW LEVEL SECURITY;

-- 3. ELIMINAR políticas antiguas para evitar conflictos
DROP POLICY IF EXISTS "Anyone can view active resale listings" ON public.resale_listings;
DROP POLICY IF EXISTS "Users can view their own listings" ON public.resale_listings;
DROP POLICY IF EXISTS "Users can create resale listings for their tickets" ON public.resale_listings;
DROP POLICY IF EXISTS "Users can update their own listings" ON public.resale_listings;
DROP POLICY IF EXISTS "Users can delete their own listings" ON public.resale_listings;

-- 4. CREAR nuevas políticas de acceso

-- Permitir que CUALQUIERA (público) vea las entradas en venta activas
CREATE POLICY "Anyone can view active resale listings" 
ON public.resale_listings FOR SELECT 
USING (status = 'active');

-- Permitir que el vendedor vea sus propias entradas (todas)
CREATE POLICY "Users can view their own listings" 
ON public.resale_listings FOR SELECT 
TO authenticated 
USING (auth.uid() = seller_id);

-- Permitir poner entradas a la venta
CREATE POLICY "Users can create resale listings for their tickets" 
ON public.resale_listings FOR INSERT 
TO authenticated 
WITH CHECK (auth.uid() = seller_id);

-- Permitir actualizar/borrar propias entradas
CREATE POLICY "Users can update their own listings" 
ON public.resale_listings FOR UPDATE 
TO authenticated 
USING (auth.uid() = seller_id);

CREATE POLICY "Users can delete their own listings" 
ON public.resale_listings FOR DELETE 
TO authenticated 
USING (auth.uid() = seller_id);

-- 5. REPARAR PERMISOS DE LECTURA DE TICKETS Y EVENTOS
-- (Necesario para que el comprador vea qué está comprando)

DROP POLICY IF EXISTS "Anyone can view tickets in active resale" ON public.tickets;
CREATE POLICY "Anyone can view tickets in active resale" 
ON public.tickets FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.resale_listings 
    WHERE resale_listings.ticket_id = tickets.id 
    AND resale_listings.status = 'active'
  )
);

DROP POLICY IF EXISTS "Anyone can view events" ON public.events;
CREATE POLICY "Anyone can view events" 
ON public.events FOR SELECT 
USING (true);

-- 6. Insertar datos de prueba (Solo si no hay nada)
DO $$
DECLARE
  v_user_id uuid;
  v_event_id uuid;
  v_ticket_id uuid;
BEGIN
  -- Intentar obtener un usuario y evento existentes
  SELECT id INTO v_user_id FROM auth.users LIMIT 1;
  SELECT id INTO v_event_id FROM public.events LIMIT 1;

  IF v_user_id IS NOT NULL AND v_event_id IS NOT NULL THEN
    -- Verificar si ya hay tickets en reventa
    IF NOT EXISTS (SELECT 1 FROM public.resale_listings) THEN
       -- Crear un ticket dummy
       INSERT INTO public.tickets (event_id, user_id, buyer_name, buyer_email, total_price, status)
       VALUES (v_event_id, v_user_id, 'Vendedor Prueba', 'test@test.com', 50, 'resale')
       RETURNING id INTO v_ticket_id;

       -- Ponerlo en reventa
       INSERT INTO public.resale_listings (ticket_id, seller_id, price, status)
       VALUES (v_ticket_id, v_user_id, 60, 'active');
    END IF;
  END IF;
END $$;
