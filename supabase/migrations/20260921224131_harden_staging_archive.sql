-- The preserved staging schema is not an API. Revoke inherited function access too.
DO $archive$
DECLARE f record;
BEGIN
  IF to_regnamespace('eclipse_prebaseline') IS NULL THEN RETURN; END IF;
  REVOKE ALL ON ALL FUNCTIONS IN SCHEMA eclipse_prebaseline FROM PUBLIC, anon, authenticated, service_role;
  FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='eclipse_prebaseline'
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = pg_catalog, eclipse_prebaseline, extensions, pg_temp',f.signature);
  END LOOP;
END $archive$;
