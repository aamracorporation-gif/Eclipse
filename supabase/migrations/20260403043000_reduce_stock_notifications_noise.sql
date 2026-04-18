CREATE OR REPLACE FUNCTION public.handle_stock_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event public.events%ROWTYPE;
  v_remaining int;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id = NEW.id;
  v_remaining := v_event.available_tickets;

  IF v_event.creator_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.notifications n
    WHERE n.user_id = v_event.creator_id
      AND n.type = 'organizer_realtime_sale'
      AND (n.data->>'event_id') = v_event.id::text
      AND n.created_at > now() - interval '30 seconds'
  ) THEN
    RETURN NEW;
  END IF;

  IF v_remaining <= 10 AND v_remaining > 0 THEN
    PERFORM public.enqueue_notification(
      v_event.creator_id,
      'organizer',
      'stock_low',
      '⚠️ Quedan pocas entradas',
      'Quedan solo ' || v_remaining || ' entradas para ' || v_event.title,
      'high',
      jsonb_build_object('event_id', v_event.id::text, 'remaining', v_remaining)
    );
  END IF;

  IF v_remaining <= 0 THEN
    PERFORM public.enqueue_notification(
      v_event.creator_id,
      'organizer',
      'stock_sold_out',
      '❌ Sold out',
      'Tu evento ' || v_event.title || ' se ha quedado sin entradas.',
      'high',
      jsonb_build_object('event_id', v_event.id::text)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ticket_insert_notifications ON public.tickets;

DROP TRIGGER IF EXISTS trg_stock_notifications ON public.events;
CREATE TRIGGER trg_stock_notifications
AFTER UPDATE OF available_tickets ON public.events
FOR EACH ROW
EXECUTE FUNCTION public.handle_stock_notifications();

NOTIFY pgrst, 'reload schema';

