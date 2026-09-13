-- Durable payment idempotency and webhook processing ledger.
ALTER TABLE public.payment_transactions
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS payment_transactions_idempotency_key_uidx
  ON public.payment_transactions (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  object_id text,
  processing_status text NOT NULL DEFAULT 'processing'
    CHECK (processing_status IN ('processing', 'processed', 'failed')),
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts > 0),
  last_error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stripe_webhook_events FROM anon, authenticated;
GRANT ALL ON public.stripe_webhook_events TO service_role;

-- QA sessions are no longer public or usable as a code-only backdoor.
ALTER TABLE public.qa_sessions ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE CASCADE;
DROP POLICY IF EXISTS "qa_sessions_public_read" ON public.qa_sessions;
DROP POLICY IF EXISTS "qa_sessions_public_write" ON public.qa_sessions;
DROP POLICY IF EXISTS "qa_sessions_owner_read" ON public.qa_sessions;
DROP POLICY IF EXISTS "qa_sessions_owner_insert" ON public.qa_sessions;
DROP POLICY IF EXISTS "qa_sessions_owner_update" ON public.qa_sessions;
DROP POLICY IF EXISTS "qa_sessions_owner_delete" ON public.qa_sessions;
REVOKE ALL ON public.qa_sessions FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.qa_sessions TO authenticated;
CREATE POLICY "qa_sessions_owner_read" ON public.qa_sessions FOR SELECT TO authenticated
  USING (created_by = auth.uid());
CREATE POLICY "qa_sessions_owner_insert" ON public.qa_sessions FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());
CREATE POLICY "qa_sessions_owner_update" ON public.qa_sessions FOR UPDATE TO authenticated
  USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());
CREATE POLICY "qa_sessions_owner_delete" ON public.qa_sessions FOR DELETE TO authenticated
  USING (created_by = auth.uid());

-- Fulfillment remains callable only by the trusted server role.
REVOKE ALL ON FUNCTION public.fulfill_payment_for_user(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_payment_for_user(text, uuid) TO service_role;
