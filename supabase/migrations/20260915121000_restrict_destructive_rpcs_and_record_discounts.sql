-- Card discount usage is recorded exactly once when fulfillment becomes
-- terminal. Maintenance and legacy scanner permissions are isolated in later
-- migrations so each production change can be validated independently.

ALTER TABLE public.discount_code_uses
  ADD COLUMN IF NOT EXISTS payment_transaction_id uuid
  REFERENCES public.payment_transactions(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS discount_code_uses_payment_transaction_uidx
  ON public.discount_code_uses(payment_transaction_id)
  WHERE payment_transaction_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.record_fulfilled_payment_discount()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_discount_code_id uuid;
  v_event_id uuid;
BEGIN
  IF NEW.status IS DISTINCT FROM 'fulfilled'
     OR OLD.status IS NOT DISTINCT FROM 'fulfilled'
     OR nullif(NEW.metadata->>'discount_code_id', '') IS NULL
  THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_discount_code_id := (NEW.metadata->>'discount_code_id')::uuid;
    v_event_id := nullif(NEW.metadata->>'event_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN NEW;
  END;

  UPDATE public.discount_codes
  SET uses_count = uses_count + 1
  WHERE id = v_discount_code_id
    AND (v_event_id IS NULL OR event_id = v_event_id);

  IF FOUND THEN
    INSERT INTO public.discount_code_uses(
      discount_code_id, buyer_name, buyer_email, payment_transaction_id
    ) VALUES (
      v_discount_code_id,
      nullif(NEW.metadata->>'buyer_name', ''),
      nullif(NEW.metadata->>'buyer_email', ''),
      NEW.id
    )
    ON CONFLICT (payment_transaction_id) WHERE payment_transaction_id IS NOT NULL
    DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_record_fulfilled_payment_discount
  ON public.payment_transactions;
CREATE TRIGGER trg_record_fulfilled_payment_discount
AFTER UPDATE OF status ON public.payment_transactions
FOR EACH ROW EXECUTE FUNCTION public.record_fulfilled_payment_discount();

REVOKE ALL ON FUNCTION public.record_fulfilled_payment_discount()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_discount_code(uuid,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_discount_code(uuid,text,text) TO service_role;
