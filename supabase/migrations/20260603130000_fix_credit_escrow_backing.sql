DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.platform_escrow_balances
    WHERE key = 'eclipse_credit_backing'
  ) THEN
    INSERT INTO public.platform_escrow_balances(key, balance_cents)
    VALUES ('eclipse_credit_backing', 0);
  END IF;
EXCEPTION WHEN undefined_table THEN
  NULL;
END $$;

DO $$
DECLARE
  v_total_credit_cents bigint;
BEGIN
  SELECT COALESCE(ROUND(SUM(COALESCE(saldo_credito, 0)) * 100, 0), 0)::bigint
  INTO v_total_credit_cents
  FROM public.creditos_usuario;

  UPDATE public.platform_escrow_balances
  SET
    balance_cents = GREATEST(balance_cents, v_total_credit_cents),
    updated_at = now()
  WHERE key = 'eclipse_credit_backing';
EXCEPTION WHEN undefined_table THEN
  NULL;
END $$;

CREATE OR REPLACE FUNCTION public.apply_credito_delta(
  p_usuario_id uuid,
  p_delta numeric,
  p_tipo public.ledger_movimiento_tipo,
  p_referencia_id text,
  p_descripcion text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_credit public.creditos_usuario%ROWTYPE;
  v_new_balance numeric;
  v_delta_cents bigint;
  v_key text := 'eclipse_credit_backing';
  v_escrow public.platform_escrow_balances%ROWTYPE;
BEGIN
  PERFORM public.ensure_credito_usuario_exists(p_usuario_id);
  PERFORM public.ensure_platform_escrow_exists(v_key);

  SELECT * INTO v_credit
  FROM public.creditos_usuario
  WHERE usuario_id = p_usuario_id
  FOR UPDATE;

  SELECT * INTO v_escrow
  FROM public.platform_escrow_balances
  WHERE key = v_key
  FOR UPDATE;

  v_new_balance := ROUND((COALESCE(v_credit.saldo_credito, 0) + COALESCE(p_delta, 0))::numeric, 2);
  IF v_new_balance < 0 THEN
    RAISE EXCEPTION 'Insufficient credit';
  END IF;

  v_delta_cents := ROUND((COALESCE(p_delta, 0)::numeric * 100)::numeric, 0)::bigint;

  IF v_delta_cents > 0 THEN
    UPDATE public.platform_escrow_balances
    SET
      balance_cents = balance_cents + v_delta_cents,
      updated_at = now()
    WHERE key = v_key;
  ELSIF v_delta_cents < 0 THEN
    IF COALESCE(v_escrow.balance_cents, 0) < (-v_delta_cents) THEN
      RAISE EXCEPTION 'Insufficient escrow backing';
    END IF;
    UPDATE public.platform_escrow_balances
    SET
      balance_cents = balance_cents + v_delta_cents,
      updated_at = now()
    WHERE key = v_key;
  END IF;

  UPDATE public.creditos_usuario
  SET saldo_credito = v_new_balance
  WHERE id = v_credit.id;

  PERFORM public.record_ledger_movimiento(p_tipo, p_usuario_id, NULL, COALESCE(p_delta, 0), p_referencia_id, p_descripcion);

  RETURN jsonb_build_object('saldo_credito', v_new_balance);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_credito_delta(uuid, numeric, public.ledger_movimiento_tipo, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_credito_delta(uuid, numeric, public.ledger_movimiento_tipo, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
