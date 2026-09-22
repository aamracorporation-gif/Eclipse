-- Patch the existing core without replacing unrelated production definitions.
DO $repair$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public.fulfill_payment_for_user_legacy_20260920(text,uuid)'::regprocedure) INTO definition;
  IF position('v_ticket_qr' IN definition) > 0 THEN RETURN; END IF;
  IF position('v_ticket_ids            uuid[];' IN definition)=0
    OR position('FOR i IN 1..v_quantity LOOP' IN definition)=0
    OR position('gen_random_uuid(), gen_random_uuid()::text,' IN definition)=0 THEN
    RAISE EXCEPTION 'Unexpected fulfillment body; review QR patch';
  END IF;
  definition:=replace(definition,'v_ticket_ids            uuid[];',E'v_ticket_ids            uuid[];\n  v_ticket_qr uuid;');
  definition:=replace(definition,'FOR i IN 1..v_quantity LOOP',E'FOR i IN 1..v_quantity LOOP\n      v_ticket_qr := gen_random_uuid();');
  definition:=replace(definition,'gen_random_uuid(), gen_random_uuid()::text,','v_ticket_qr, v_ticket_qr::text,');
  EXECUTE definition;
END $repair$;
REVOKE ALL ON FUNCTION public.fulfill_payment_for_user_legacy_20260920(text,uuid) FROM PUBLIC, anon, authenticated, service_role;
