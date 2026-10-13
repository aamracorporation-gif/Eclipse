-- Keep the commercial record. Cancellation/refunds are a separate workflow.
-- NOT VALID preserves historical orphan payments for reconciliation; new writes
-- are checked immediately. No purchases, payments or events are removed.
ALTER TABLE public.payment_transactions
  ADD COLUMN protected_event_id uuid GENERATED ALWAYS AS (
    CASE WHEN metadata->>'event_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (metadata->>'event_id')::uuid ELSE NULL END
  ) STORED;
CREATE INDEX payment_transactions_protected_event_idx ON public.payment_transactions(protected_event_id);
ALTER TABLE public.payment_transactions
  ADD CONSTRAINT payment_transactions_protected_event_fkey
  FOREIGN KEY (protected_event_id) REFERENCES public.events(id) ON DELETE RESTRICT NOT VALID;

ALTER TABLE public.tickets DROP CONSTRAINT tickets_event_id_fkey;
ALTER TABLE public.tickets ADD CONSTRAINT tickets_event_id_fkey
  FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE RESTRICT NOT VALID;
CREATE INDEX IF NOT EXISTS tickets_event_history_idx ON public.tickets(event_id);

CREATE SCHEMA IF NOT EXISTS private;
CREATE OR REPLACE FUNCTION private.protect_event_purchase_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- This trigger cannot expose rows or mutate them. It must see history hidden
  -- by buyer RLS; the original DELETE remains governed by the event's RLS.
  IF coalesce(OLD.sold_tickets, 0) > 0
    OR EXISTS (SELECT 1 FROM public.tickets WHERE event_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.payment_transactions WHERE protected_event_id = OLD.id)
  THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'EVENT_HAS_PURCHASE_HISTORY',
      DETAIL = 'El evento tiene entradas o pagos asociados. Gestiona su cancelación sin borrar el historial.';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION private.protect_event_purchase_history() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER a00_protect_event_purchase_history BEFORE DELETE ON public.events
  FOR EACH ROW EXECUTE FUNCTION private.protect_event_purchase_history();

COMMENT ON COLUMN public.payment_transactions.protected_event_id IS
  'Derived from purchase metadata; prevents event deletion, including concurrent checkout. Legacy orphans remain available for reconciliation.';
