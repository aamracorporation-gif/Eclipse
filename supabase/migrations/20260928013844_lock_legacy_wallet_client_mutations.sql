-- Legacy balances are server-maintained mirrors, never client-writable money.
DROP POLICY IF EXISTS "Users can update own wallet" ON public.wallets;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.wallets FROM PUBLIC, anon, authenticated;
-- Keep existing SELECT policies and service-role grants unchanged.
