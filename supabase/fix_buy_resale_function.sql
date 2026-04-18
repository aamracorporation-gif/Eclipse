-- ==============================================================================
-- SCRIPT DE REPARACIÓN DE LA FUNCIÓN DE COMPRA (buy_resale_ticket)
-- Ejecuta esto para corregir el error: "Could not find the function public.buy_resale_ticket"
-- ==============================================================================

-- 1. Eliminar versiones anteriores para asegurar limpieza
DROP FUNCTION IF EXISTS public.buy_resale_ticket(uuid, uuid);

-- 2. Crear la función correctamente
CREATE OR REPLACE FUNCTION public.buy_resale_ticket(
  p_listing_id uuid,
  p_buyer_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER -- Ejecutar con permisos de superusuario para saltar RLS estrictas si es necesario
AS $$
DECLARE
  v_listing RECORD;
  v_buyer_wallet RECORD;
  v_seller_wallet RECORD;
  v_ticket_id uuid;
BEGIN
  -- A. Verificar que el listing existe y está activo (BLOQUEO DE FILA)
  SELECT * INTO v_listing
  FROM public.resale_listings
  WHERE id = p_listing_id AND status = 'active'
  FOR UPDATE;

  IF v_listing IS NULL THEN
    RAISE EXCEPTION 'La entrada ya no está disponible o ha sido vendida.';
  END IF;

  v_ticket_id := v_listing.ticket_id;

  -- B. Verificar que el comprador no sea el vendedor
  IF v_listing.seller_id = p_buyer_id THEN
    RAISE EXCEPTION 'No puedes comprar tu propia entrada.';
  END IF;

  -- C. Verificar y Bloquear Cartera del Comprador
  SELECT * INTO v_buyer_wallet
  FROM public.wallets
  WHERE user_id = p_buyer_id
  FOR UPDATE;

  -- Si no tiene cartera, intentar crearla (defensivo)
  IF v_buyer_wallet IS NULL THEN
    INSERT INTO public.wallets (user_id, balance) VALUES (p_buyer_id, 0)
    RETURNING * INTO v_buyer_wallet;
  END IF;

  IF v_buyer_wallet.balance < v_listing.price THEN
    RAISE EXCEPTION 'Saldo insuficiente. Recarga tu cartera primero.';
  END IF;

  -- D. Verificar y Bloquear Cartera del Vendedor
  SELECT * INTO v_seller_wallet
  FROM public.wallets
  WHERE user_id = v_listing.seller_id
  FOR UPDATE;

  -- Si el vendedor no tiene cartera, crearla
  IF v_seller_wallet IS NULL THEN
    INSERT INTO public.wallets (user_id, balance) VALUES (v_listing.seller_id, 0)
    RETURNING * INTO v_seller_wallet;
  END IF;

  -- E. EJECUTAR TRANSACCIÓN

  -- 1. Restar dinero al comprador
  UPDATE public.wallets
  SET balance = balance - v_listing.price,
      updated_at = now()
  WHERE id = v_buyer_wallet.id;

  -- 2. Sumar dinero al vendedor
  UPDATE public.wallets
  SET balance = balance + v_listing.price,
      updated_at = now()
  WHERE id = v_seller_wallet.id;

  -- 3. Registrar transacciones (Opcional, pero recomendado si tienes tabla de transacciones)
  -- INSERT INTO wallet_transactions ... (Omitido para simplificar, a menos que sea estricto)

  -- 4. Transferir propiedad del Ticket
  UPDATE public.tickets
  SET user_id = p_buyer_id,    -- Nuevo dueño
      status = 'valid'         -- Vuelve a ser válido (ya no está en reventa)
  WHERE id = v_ticket_id;

  -- 5. Marcar listing como vendido
  UPDATE public.resale_listings
  SET status = 'sold',
      updated_at = now()
  WHERE id = p_listing_id;

  RETURN json_build_object(
    'success', true, 
    'message', 'Entrada comprada correctamente',
    'new_balance', v_buyer_wallet.balance - v_listing.price
  );

EXCEPTION
  WHEN OTHERS THEN
    -- Propagar el error original
    RAISE;
END;
$$;

-- 3. Otorgar permisos de ejecución (CRÍTICO)
GRANT EXECUTE ON FUNCTION public.buy_resale_ticket(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.buy_resale_ticket(uuid, uuid) TO public;
GRANT EXECUTE ON FUNCTION public.buy_resale_ticket(uuid, uuid) TO anon;

-- 4. Notificar recarga de esquema (Por si acaso Supabase cachea)
NOTIFY pgrst, 'reload schema';
