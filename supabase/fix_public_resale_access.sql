-- ==============================================================================
-- SCRIPT DE REPARACIÓN DE VISIBILIDAD DE REVENTA PÚBLICA
-- Ejecuta esto para que TODOS puedan ver las entradas en reventa
-- ==============================================================================

-- 1. Asegurar visibilidad de resale_listings (Reventa)
-- Permitir que CUALQUIERA (autenticado o anon) vea listados activos
DROP POLICY IF EXISTS "Anyone can view active resale listings" ON public.resale_listings;
CREATE POLICY "Anyone can view active resale listings"
  ON public.resale_listings FOR SELECT
  USING (status = 'active');

-- 2. Asegurar visibilidad de tickets (Entradas)
-- CRÍTICO: Para mostrar qué entrada se vende, el comprador necesita ver el ticket
-- aunque no sea suyo.
DROP POLICY IF EXISTS "Public can view tickets in active resale" ON public.tickets;
CREATE POLICY "Public can view tickets in active resale"
  ON public.tickets FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.resale_listings 
      WHERE resale_listings.ticket_id = tickets.id 
      AND resale_listings.status = 'active'
    )
  );

-- 3. Asegurar visibilidad de events (Eventos)
-- Todos deben poder ver los eventos para saber de qué es la entrada
DROP POLICY IF EXISTS "Public can view events" ON public.events;
CREATE POLICY "Public can view events"
  ON public.events FOR SELECT
  USING (true);

-- 4. Asegurar visibilidad de event_ticket_types (Tipos de entrada)
-- Necesario si se hace join con tipos de entrada
DROP POLICY IF EXISTS "Public can view ticket types" ON public.event_ticket_types;
CREATE POLICY "Public can view ticket types"
  ON public.event_ticket_types FOR SELECT
  USING (true);

-- 5. Verificación de integridad (Opcional, para debug)
-- Asegura que no haya tickets en reventa que apunten a tickets inexistentes
DELETE FROM public.resale_listings
WHERE ticket_id NOT IN (SELECT id FROM public.tickets);
