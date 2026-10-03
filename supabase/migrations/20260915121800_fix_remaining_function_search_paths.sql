-- Finish the search_path hardening for SECURITY INVOKER helpers and make every
-- trigger-only routine unavailable as an RPC regardless of security mode.

DO $migration$
DECLARE
  v_function record;
BEGIN
  FOR v_function IN
    SELECT n.nspname AS schema_name,
           p.proname AS function_name,
           pg_get_function_identity_arguments(p.oid) AS identity_arguments,
           p.prorettype = 'trigger'::regtype AS is_trigger
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %I.%I(%s) SET search_path TO pg_catalog, public, extensions, pg_temp',
      v_function.schema_name,
      v_function.function_name,
      v_function.identity_arguments
    );
    IF v_function.is_trigger THEN
      EXECUTE format(
        'REVOKE ALL ON FUNCTION %I.%I(%s) FROM PUBLIC, anon, authenticated',
        v_function.schema_name,
        v_function.function_name,
        v_function.identity_arguments
      );
    END IF;
  END LOOP;
END
$migration$;
