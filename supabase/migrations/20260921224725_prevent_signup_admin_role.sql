-- Narrow, drift-aware repair: preserve all other signup behavior and existing users.
DO $repair$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public.handle_new_user()'::regprocedure) INTO definition;
  IF position('(''attendee'', ''organizer'', ''admin'')' IN definition) > 0 THEN
    definition := replace(definition,
      '(''attendee'', ''organizer'', ''admin'')', '(''attendee'', ''organizer'')');
    EXECUTE definition;
  ELSIF position('(''attendee'', ''organizer'')' IN definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected signup role whitelist; review before applying';
  END IF;
END $repair$;
