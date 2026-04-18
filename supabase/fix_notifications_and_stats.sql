
-- 1. Asegurar que existe la columna de estadísticas en perfiles (comprador y organizador)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS tickets_purchased integer DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS organizer_total_revenue numeric DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS organizer_tickets_sold integer DEFAULT 0;

-- 1.1 Recalcular estadísticas existentes (Backfill) para asegurar precisión inicial en PERFILES
DO $$
BEGIN
  -- Actualizar estadísticas de organizadores
  UPDATE public.profiles p
  SET 
    organizer_total_revenue = (
      SELECT COALESCE(SUM(t.total_price), 0)
      FROM public.tickets t
      JOIN public.events e ON t.event_id = e.id
      WHERE e.creator_id = p.id
    ),
    organizer_tickets_sold = (
      SELECT COALESCE(SUM(t.quantity), 0)
      FROM public.tickets t
      JOIN public.events e ON t.event_id = e.id
      WHERE e.creator_id = p.id
    )
  WHERE EXISTS (SELECT 1 FROM public.events e WHERE e.creator_id = p.id);
END $$;

-- 1.2 Recalcular estadísticas en EVENTOS y TIPOS DE ENTRADA (Corrección de conteo)
DO $$
BEGIN
  -- Actualizar contador de ventas en tabla EVENTS
  UPDATE public.events e
  SET sold = (
    SELECT COALESCE(SUM(t.quantity), 0)
    FROM public.tickets t
    WHERE t.event_id = e.id
  );

  -- Actualizar contador de ventas en tabla TICKET_TYPES
  UPDATE public.ticket_types tt
  SET sold = (
    SELECT COALESCE(SUM(t.quantity), 0)
    FROM public.tickets t
    WHERE t.ticket_type_id = tt.id
  );
END $$;

-- 2. Actualizar trigger para estadísticas en tiempo real (Perfiles + Eventos + Tipos)
CREATE OR REPLACE FUNCTION public.handle_ticket_purchase_complete()
RETURNS TRIGGER AS $$
DECLARE
  v_event public.events;
  v_venue_name text;
BEGIN
  -- Obtener datos del evento
  SELECT * INTO v_event FROM public.events WHERE id = NEW.event_id;
  
  -- Obtener nombre del lugar
  SELECT name INTO v_venue_name FROM public.venues WHERE id = v_event.venue_id;
  
  -- 1. Al Cliente (Comprador) - Estadísticas de compra
  IF NEW.user_id IS NOT NULL THEN
    UPDATE public.profiles
    SET tickets_purchased = COALESCE(tickets_purchased, 0) + COALESCE(NEW.quantity, 0)
    WHERE id = NEW.user_id;
  END IF;
  
  -- 2. Al Organizador - Estadísticas de venta
  IF v_event.creator_id IS NOT NULL THEN
    UPDATE public.profiles
    SET 
      organizer_total_revenue = COALESCE(organizer_total_revenue, 0) + COALESCE(NEW.total_price, 0),
      organizer_tickets_sold = COALESCE(organizer_tickets_sold, 0) + COALESCE(NEW.quantity, 0)
    WHERE id = v_event.creator_id;
  END IF;

  -- 3. Al Evento - Actualizar contador de vendidos
  UPDATE public.events
  SET sold = COALESCE(sold, 0) + COALESCE(NEW.quantity, 0)
  WHERE id = NEW.event_id;

  -- 4. Al Tipo de Entrada - Actualizar contador de vendidos
  IF NEW.ticket_type_id IS NOT NULL THEN
    UPDATE public.ticket_types
    SET sold = COALESCE(sold, 0) + COALESCE(NEW.quantity, 0)
    WHERE id = NEW.ticket_type_id;
  END IF;
  
  -- Notificaciones (existente)
  PERFORM public.create_notification(
    NEW.user_id,
    'Compra Exitosa',
    'Has comprado ' || NEW.quantity || ' entradas para ' || v_event.title,
    'ticket_purchase'
  );

  IF v_event.creator_id IS NOT NULL THEN
    PERFORM public.create_notification(
      v_event.creator_id,
      'Nueva Venta',
      'Se han vendido ' || NEW.quantity || ' entradas para ' || v_event.title,
      'ticket_sale'
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
