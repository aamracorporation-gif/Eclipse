-- Run only against Eclipse staging. All fixture changes are rolled back.
BEGIN;
DO $test$
DECLARE
  buyer uuid := 'a9270000-0000-4000-8000-000000000001';
  event_id uuid := 'a9270000-0000-4000-8000-000000000003';
  vip_id uuid := gen_random_uuid();
  result json;
  ticket public.tickets%ROWTYPE;
  scenario text;
  blocked boolean;
  before_balance numeric;
  before_count bigint;
  arity integer;
  before_stock integer;
  before_escrow bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = buyer AND email = 'qa-buyer-20260927@example.test') THEN
    RAISE EXCEPTION 'Expected staging QA fixture is missing';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', buyer::text, true);
  PERFORM public.ensure_credito_usuario_exists(buyer);
  UPDATE public.creditos_usuario SET saldo_credito = 100 WHERE usuario_id = buyer;
  PERFORM public.ensure_platform_escrow_exists('eclipse_credit_backing');
  UPDATE public.platform_escrow_balances SET balance_cents = 10000 WHERE key = 'eclipse_credit_backing';
  UPDATE public.events SET event_date = now() + interval '1 day', end_datetime = now() + interval '2 days',
    is_cancelled = false, available_tickets = 20 WHERE id = event_id;
  INSERT INTO public.reservados_vip(id,event_id,name,base_price,capacity_people,quantity_available,is_active)
    VALUES(vip_id,event_id,'QA wallet VIP rollback only',10,4,3,true);

  FOREACH arity IN ARRAY ARRAY[4,5] LOOP
  FOREACH scenario IN ARRAY ARRAY['inactive','deleted','sold_out','cancelled_event','expired_event','wrong_user'] LOOP
    UPDATE public.reservados_vip SET is_active=true,deleted_at=NULL,quantity_available=3 WHERE id=vip_id;
    UPDATE public.events SET is_cancelled=false,end_datetime=now()+interval '2 days' WHERE id=event_id;
    IF scenario='inactive' THEN UPDATE public.reservados_vip SET is_active=false WHERE id=vip_id; END IF;
    IF scenario='deleted' THEN UPDATE public.reservados_vip SET deleted_at=now() WHERE id=vip_id; END IF;
    IF scenario='sold_out' THEN UPDATE public.reservados_vip SET quantity_available=0 WHERE id=vip_id; END IF;
    IF scenario='cancelled_event' THEN UPDATE public.events SET is_cancelled=true WHERE id=event_id; END IF;
    IF scenario='expired_event' THEN UPDATE public.events SET end_datetime=now()-interval '1 hour' WHERE id=event_id; END IF;
    IF scenario='wrong_user' THEN PERFORM set_config('request.jwt.claim.sub','a9270000-0000-4000-8000-000000000002',true); END IF;
    SELECT saldo_credito INTO before_balance FROM public.creditos_usuario WHERE usuario_id=buyer;
    SELECT count(*) INTO before_count FROM public.tickets WHERE user_id=buyer;
    SELECT quantity_available INTO before_stock FROM public.reservados_vip WHERE id=vip_id;
    SELECT balance_cents INTO before_escrow FROM public.platform_escrow_balances WHERE key='eclipse_credit_backing';
    blocked := false;
    BEGIN
      IF arity=4 THEN
        PERFORM public.buy_vip_with_credito(vip_id,buyer,'QA','qa@example.test');
      ELSE
        PERFORM public.buy_vip_with_credito(vip_id,buyer,'QA','qa@example.test',0::numeric);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT IN ('VIP sold out','Event not available','Not authorized') THEN RAISE; END IF;
      blocked := true;
    END;
    IF NOT blocked THEN RAISE EXCEPTION 'Unsafe VIP wallet purchase accepted: %',scenario; END IF;
    IF (SELECT saldo_credito FROM public.creditos_usuario WHERE usuario_id=buyer) IS DISTINCT FROM before_balance
      OR (SELECT count(*) FROM public.tickets WHERE user_id=buyer) <> before_count
      OR (SELECT quantity_available FROM public.reservados_vip WHERE id=vip_id) <> before_stock
      OR (SELECT balance_cents FROM public.platform_escrow_balances WHERE key='eclipse_credit_backing') <> before_escrow THEN
      RAISE EXCEPTION 'Rejected purchase changed balance or tickets: %',scenario;
    END IF;
    PERFORM set_config('request.jwt.claim.sub',buyer::text,true);
  END LOOP;
  END LOOP;

  UPDATE public.reservados_vip SET is_active=true,deleted_at=NULL,quantity_available=3 WHERE id=vip_id;
  UPDATE public.events SET is_cancelled=false,end_datetime=now()+interval '2 days' WHERE id=event_id;
  result := public.buy_vip_with_credito(vip_id,buyer,'QA','qa@example.test',0::numeric);
  SELECT * INTO ticket FROM public.tickets WHERE id=(result->>'ticket_id')::uuid;
  IF ticket.id IS NULL OR ticket.qr_code IS DISTINCT FROM ticket.qr_token::text
    OR ticket.quantity <> 4 OR ticket.payment_status IS DISTINCT FROM 'paid'
    OR ticket.ticket_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'VIP ticket QR or paid/active state is inconsistent';
  END IF;
  IF (SELECT saldo_credito FROM public.creditos_usuario WHERE usuario_id=buyer) <> 90
    OR (SELECT quantity_available FROM public.reservados_vip WHERE id=vip_id) <> 2 THEN
    RAISE EXCEPTION 'Valid VIP purchase did not debit once or decrement stock once';
  END IF;

  -- Exercise the public overload under the actual client database role.
  EXECUTE 'SET LOCAL ROLE authenticated';
  result := public.buy_vip_with_credito(vip_id,buyer,'QA','qa@example.test');
  EXECUTE 'RESET ROLE';
  SELECT * INTO ticket FROM public.tickets WHERE id=(result->>'ticket_id')::uuid;
  IF ticket.id IS NULL OR ticket.qr_code IS DISTINCT FROM ticket.qr_token::text
    OR ticket.payment_status IS DISTINCT FROM 'paid' OR ticket.quantity <> 4 THEN
    RAISE EXCEPTION 'Public VIP wallet RPC produced inconsistent ticket';
  END IF;
  IF (SELECT saldo_credito FROM public.creditos_usuario WHERE usuario_id=buyer) <> 80
    OR (SELECT quantity_available FROM public.reservados_vip WHERE id=vip_id) <> 1 THEN
    RAISE EXCEPTION 'Public VIP wallet RPC debit or inventory mismatch';
  END IF;
  IF has_function_privilege('authenticated','public.buy_vip_with_credito(uuid,uuid,text,text,numeric)','EXECUTE')
    OR has_function_privilege('anon','public.buy_vip_with_credito(uuid,uuid,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'VIP wallet RPC privileges expanded';
  END IF;
END;
$test$;
SELECT 'PASS: 12 rejection cases, two valid purchases, public authenticated RPC and unchanged execution grants' AS result;
ROLLBACK;
