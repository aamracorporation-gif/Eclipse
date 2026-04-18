CREATE OR REPLACE FUNCTION public.handle_stock_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_remaining int;
  v_last_low_stock timestamptz;
BEGIN
  v_remaining := NEW.available_tickets;

  IF NEW.creator_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_remaining <= 10 AND v_remaining > 0 THEN
    SELECT max(created_at) INTO v_last_low_stock
    FROM public.notifications
    WHERE user_id = NEW.creator_id
      AND type = 'stock_low'
      AND (data->>'event_id')::uuid = NEW.id;

    IF v_last_low_stock IS NULL OR v_last_low_stock < now() - interval '30 minutes' THEN
      PERFORM public.enqueue_notification(
        NEW.creator_id,
        'organizer',
        'stock_low',
        '⚠️ Quedan pocas entradas',
        'Quedan solo ' || v_remaining || ' entradas para ' || NEW.title,
        'high',
        jsonb_build_object('event_id', NEW.id, 'remaining', v_remaining)
      );
    END IF;
  END IF;

  IF v_remaining <= 0 THEN
    PERFORM public.enqueue_notification(
      NEW.creator_id,
      'organizer',
      'stock_sold_out',
      '❌ Sold out',
      'Tu evento ' || NEW.title || ' se ha quedado sin entradas.',
      'high',
      jsonb_build_object('event_id', NEW.id)
    );
  END IF;

  RETURN NEW;
END;
$$;
