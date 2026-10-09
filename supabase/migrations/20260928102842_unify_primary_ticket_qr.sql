-- Generate a single QR identity per primary ticket; preserve existing tickets and grants.
DO $migration$
DECLARE
  definition text := pg_get_functiondef('public.fulfill_payment_for_user_legacy_20260920(text,uuid)'::regprocedure);
  old_fragment text := E'        gen_random_uuid(), gen_random_uuid()::text,\n        v_ticket_type_id, v_single_price,';
BEGIN
  IF (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment) <> 1
    OR position('  v_ticket_ids            uuid[];' in definition)=0
    OR position(E'    FOR i IN 1..v_quantity LOOP\n      INSERT INTO public.tickets (' in definition)=0 THEN
    RAISE EXCEPTION 'Primary ticket QR migration: unexpected function definition';
  END IF;
  definition:=replace(definition,'  v_ticket_ids            uuid[];',E'  v_ticket_ids            uuid[];\n  v_primary_qr            uuid;');
  definition:=replace(definition,E'    FOR i IN 1..v_quantity LOOP\n      INSERT INTO public.tickets (',E'    FOR i IN 1..v_quantity LOOP\n      v_primary_qr := gen_random_uuid();\n      INSERT INTO public.tickets (');
  definition:=replace(definition,old_fragment,E'        v_primary_qr, v_primary_qr::text,\n        v_ticket_type_id, v_single_price,');
  EXECUTE definition;
END;
$migration$;
