-- ==============================================================================
-- SCRIPT DE DEBUG: CREAR DATOS DE PRUEBA Y LIMPIAR
-- Ejecuta esto para asegurar que hay AL MENOS UNA entrada en reventa visible
-- ==============================================================================

-- 1. Limpiar datos huérfanos (Listados que apuntan a tickets que no existen)
DELETE FROM public.resale_listings
WHERE ticket_id NOT IN (SELECT id FROM public.tickets);

-- 2. Asegurar RLS permisivo (Repetimos por seguridad)
DROP POLICY IF EXISTS "Anyone can view active resale listings" ON public.resale_listings;
CREATE POLICY "Anyone can view active resale listings" ON public.resale_listings FOR SELECT USING (status = 'active');

DROP POLICY IF EXISTS "Public can view tickets in active resale" ON public.tickets;
CREATE POLICY "Public can view tickets in active resale" ON public.tickets FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.resale_listings WHERE resale_listings.ticket_id = tickets.id AND resale_listings.status = 'active')
);

DROP POLICY IF EXISTS "Public can view events" ON public.events;
CREATE POLICY "Public can view events" ON public.events FOR SELECT USING (true);

-- 3. Crear Datos de Prueba (Test Event, Test Ticket, Test Resale)
DO $$
DECLARE
  v_venue_id uuid;
  v_event_id uuid;
  v_user_id uuid;
  v_ticket_id uuid;
BEGIN
  -- Obtener un usuario cualquiera (el primero que encontremos)
  SELECT id INTO v_user_id FROM auth.users LIMIT 1;
  
  IF v_user_id IS NULL THEN
    RAISE NOTICE 'No hay usuarios en la BD. Regístrate primero en la app.';
    RETURN;
  END IF;

  -- Crear Venue (si no existe)
  INSERT INTO public.venues (name, address, latitude, longitude, description)
  VALUES ('Debug Venue', 'Calle Debug 123', 0, 0, 'Venue para pruebas')
  ON CONFLICT DO NOTHING;
  
  SELECT id INTO v_venue_id FROM public.venues LIMIT 1;

  -- Crear Evento de Prueba
  INSERT INTO public.events (venue_id, title, description, event_date, ticket_price, available_tickets, creator_id)
  VALUES (v_venue_id, 'EVENTO DE PRUEBA REVENTA', 'Si ves esto, la reventa funciona.', now() + interval '7 days', 50.00, 100, v_user_id)
  RETURNING id INTO v_event_id;

  -- Crear Ticket para ese usuario
  INSERT INTO public.tickets (event_id, user_id, buyer_name, buyer_email, quantity, total_price, qr_code)
  VALUES (v_event_id, v_user_id, 'Tester', 'test@test.com', 1, 50.00, 'DEBUG-QR')
  RETURNING id INTO v_ticket_id;

  -- Ponerlo en Reventa
  INSERT INTO public.resale_listings (ticket_id, seller_id, price, status)
  VALUES (v_ticket_id, v_user_id, 45.00, 'active');

  RAISE NOTICE 'Datos de prueba creados exitosamente. Evento ID: %, Ticket ID: %', v_event_id, v_ticket_id;
END $$;
