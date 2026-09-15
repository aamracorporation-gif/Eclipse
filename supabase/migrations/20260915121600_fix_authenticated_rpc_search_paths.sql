-- The authenticated SECURITY DEFINER allowlist must resolve database objects
-- through a fixed, trusted search path. Discount validation also explicitly
-- requires a signed-in user.

CREATE OR REPLACE FUNCTION public.validate_discount_code(
  p_code text,
  p_event_id uuid,
  p_quantity integer DEFAULT 1
)
RETURNS public.discount_codes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
  v_code public.discount_codes%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(p_code), '') IS NULL OR p_event_id IS NULL OR p_quantity < 1 OR p_quantity > 20 THEN
    RAISE EXCEPTION 'Invalid discount request';
  END IF;

  SELECT * INTO v_code
  FROM public.discount_codes
  WHERE event_id = p_event_id
    AND lower(code) = lower(btrim(p_code))
    AND is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Código de descuento no válido o no existe para este evento.';
  END IF;
  IF v_code.valid_until IS NOT NULL AND v_code.valid_until < now() THEN
    RAISE EXCEPTION 'Este código de descuento ha expirado.';
  END IF;
  IF v_code.valid_from > now() THEN
    RAISE EXCEPTION 'Este código todavía no está activo.';
  END IF;
  IF v_code.max_uses IS NOT NULL AND v_code.uses_count >= v_code.max_uses THEN
    RAISE EXCEPTION 'Este código ha alcanzado su límite de usos.';
  END IF;
  IF p_quantity < v_code.min_tickets THEN
    RAISE EXCEPTION 'Este código requiere un mínimo de % entrada(s).', v_code.min_tickets;
  END IF;

  RETURN v_code;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_discount_code(text,uuid,integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_discount_code(text,uuid,integer)
  TO authenticated, service_role;

DO $migration$
DECLARE
  v_function record;
BEGIN
  FOR v_function IN
    SELECT n.nspname AS schema_name,
           p.proname AS function_name,
           pg_get_function_identity_arguments(p.oid) AS identity_arguments
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %I.%I(%s) SET search_path TO pg_catalog, public, extensions, pg_temp',
      v_function.schema_name,
      v_function.function_name,
      v_function.identity_arguments
    );
  END LOOP;
END
$migration$;
