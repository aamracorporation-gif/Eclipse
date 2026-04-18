CREATE OR REPLACE FUNCTION public.admin_purge_user_data(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_worker_ids uuid[];
  v_tx_ids uuid[];
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  SELECT coalesce(array_agg(w.id), ARRAY[]::uuid[])
  INTO v_worker_ids
  FROM public.workers w
  WHERE w.user_id = p_user_id OR w.organizer_id = p_user_id;

  IF array_length(v_worker_ids, 1) IS NOT NULL THEN
    UPDATE public.tickets
    SET sold_by_worker_id = NULL
    WHERE sold_by_worker_id = ANY(v_worker_ids);

    UPDATE public.tickets
    SET scanned_by_worker_id = NULL
    WHERE scanned_by_worker_id = ANY(v_worker_ids);

    DELETE FROM public.workers
    WHERE id = ANY(v_worker_ids);
  END IF;

  UPDATE public.events
  SET creator_id = NULL
  WHERE creator_id = p_user_id;

  SELECT coalesce(array_agg(pt.id), ARRAY[]::uuid[])
  INTO v_tx_ids
  FROM public.payment_transactions pt
  WHERE pt.user_id = p_user_id;

  IF array_length(v_tx_ids, 1) IS NOT NULL THEN
    UPDATE public.tickets
    SET payment_transaction_id = NULL
    WHERE payment_transaction_id = ANY(v_tx_ids);
  END IF;

  DELETE FROM public.resale_transactions
  WHERE seller_id = p_user_id
     OR buyer_id = p_user_id
     OR (array_length(v_tx_ids, 1) IS NOT NULL AND payment_transaction_id = ANY(v_tx_ids));

  DELETE FROM public.resale_listings
  WHERE seller_id = p_user_id;

  UPDATE public.tickets
  SET
    user_id = NULL,
    buyer_name = NULL,
    buyer_email = NULL
  WHERE user_id = p_user_id;

  DELETE FROM public.notification_deliveries d
  USING public.notifications n
  WHERE d.notification_id = n.id
    AND n.user_id = p_user_id;

  DELETE FROM public.notifications
  WHERE user_id = p_user_id;

  DELETE FROM public.notification_settings
  WHERE user_id = p_user_id;

  DELETE FROM public.user_push_tokens
  WHERE user_id = p_user_id;

  DELETE FROM public.wallet_transactions wt
  USING public.wallets w
  WHERE wt.wallet_id = w.id
    AND w.user_id = p_user_id;

  DELETE FROM public.wallets
  WHERE user_id = p_user_id;

  IF array_length(v_tx_ids, 1) IS NOT NULL THEN
    DELETE FROM public.payment_transactions
    WHERE id = ANY(v_tx_ids);
  END IF;

  DELETE FROM public.profiles
  WHERE id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_purge_user_data(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_purge_user_data(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

