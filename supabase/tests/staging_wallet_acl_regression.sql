-- Existing synthetic staging seller only; no persistent balance changes.
BEGIN;
DO $test$
DECLARE
  seller uuid := 'a9270000-0000-4000-8000-000000000002';
  seen numeric;
  blocked boolean := false;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=seller AND email='qa-seller-20260927@example.test') THEN
    RAISE EXCEPTION 'Missing staging QA seller';
  END IF;
  PERFORM set_config('request.jwt.claim.sub',seller::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT balance INTO seen FROM public.wallets WHERE user_id=seller;
  IF seen IS NULL THEN RAISE EXCEPTION 'Own-wallet read unexpectedly blocked'; END IF;
  IF EXISTS(SELECT 1 FROM public.wallets WHERE user_id<>seller) THEN
    RAISE EXCEPTION 'Another user wallet is visible';
  END IF;
  BEGIN
    UPDATE public.wallets SET balance=balance+123 WHERE user_id=seller;
  EXCEPTION WHEN insufficient_privilege THEN blocked:=true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'Client can still mutate wallet balance'; END IF;
  IF has_table_privilege('authenticated','public.wallets','INSERT')
    OR has_table_privilege('authenticated','public.wallets','DELETE')
    OR has_table_privilege('authenticated','public.wallets','TRUNCATE')
    OR has_table_privilege('anon','public.wallets','UPDATE') THEN
    RAISE EXCEPTION 'Client wallet mutation grants remain';
  END IF;
  EXECUTE 'RESET ROLE';
  EXECUTE 'SET LOCAL ROLE service_role';
  UPDATE public.wallets SET balance=balance WHERE user_id=seller;
  IF NOT FOUND THEN RAISE EXCEPTION 'Server wallet update is blocked'; END IF;
  EXECUTE 'RESET ROLE';
END;
$test$;
SELECT 'PASS: own read, cross-user isolation, denied client mutations and retained server writes' AS result;
ROLLBACK;
