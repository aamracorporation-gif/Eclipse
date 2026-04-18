-- Ejecuta este código tal cual. Las líneas que empiezan con "--" son comentarios y no dan error.

-- 1. Permitir ver reventa activa
DROP POLICY IF EXISTS "Anyone can view active resale listings" ON public.resale_listings;
CREATE POLICY "Anyone can view active resale listings" ON public.resale_listings FOR SELECT USING (status = 'active');

-- 2. Permitir ver tickets en reventa
DROP POLICY IF EXISTS "Public can view tickets in active resale" ON public.tickets;
CREATE POLICY "Public can view tickets in active resale" ON public.tickets FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.resale_listings WHERE resale_listings.ticket_id = tickets.id AND resale_listings.status = 'active')
);

-- 3. Permitir ver eventos
DROP POLICY IF EXISTS "Public can view events" ON public.events;
CREATE POLICY "Public can view events" ON public.events FOR SELECT USING (true);
