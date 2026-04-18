ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS role text DEFAULT 'attendee',
  ADD COLUMN IF NOT EXISTS type text,
  ADD COLUMN IF NOT EXISTS title text DEFAULT 'Notificación',
  ADD COLUMN IF NOT EXISTS body text DEFAULT '',
  ADD COLUMN IF NOT EXISTS data jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS priority text DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS read boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS read_at timestamptz,
  ADD COLUMN IF NOT EXISTS channels text[] DEFAULT ARRAY['in_app','push']::text[];

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='notifications' AND column_name='owner_id'
  ) THEN
    UPDATE public.notifications
    SET user_id = owner_id
    WHERE user_id IS NULL;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.handle_payment_fulfilled_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event public.events%ROWTYPE;
  v_qty int;
  v_name text;
  v_listing public.resale_listings%ROWTYPE;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM 'fulfilled' OR OLD.status = 'fulfilled' THEN
    RETURN NEW;
  END IF;

  IF NEW.kind = 'event_ticket' THEN
    v_qty := GREATEST(COALESCE((NEW.metadata->>'quantity')::int, 1), 1);
    v_name := COALESCE(NULLIF(NEW.metadata->>'buyer_name', ''), '¡Genial!');

    SELECT * INTO v_event FROM public.events WHERE id = (NEW.metadata->>'event_id')::uuid;
    IF v_event.id IS NOT NULL THEN
      BEGIN
        PERFORM public.enqueue_notification(
          NEW.user_id,
          'attendee',
          'purchase_completed',
          '🎉 ¡Compra completada!',
          '¡Listo, ' || v_name || '! Tu compra para "' || v_event.title || '" se confirmó. Tienes ' || v_qty || ' entrada(s) lista(s) en Mis Entradas.',
          'high',
          jsonb_build_object('event_id', v_event.id::text, 'quantity', v_qty, 'payment_intent_id', NEW.stripe_payment_intent_id)
        );
      EXCEPTION WHEN others THEN
        NULL;
      END;
    END IF;
  ELSIF NEW.kind = 'resale_ticket' THEN
    v_qty := 1;
    v_name := COALESCE(NULLIF(NEW.metadata->>'buyer_name', ''), '¡Genial!');

    SELECT * INTO v_listing
    FROM public.resale_listings
    WHERE id = NULLIF(NEW.metadata->>'listing_id', '')::uuid;

    IF v_listing.id IS NOT NULL THEN
      SELECT e.* INTO v_event
      FROM public.tickets t
      JOIN public.events e ON e.id = t.event_id
      WHERE t.id = v_listing.ticket_id;

      IF v_event.id IS NOT NULL THEN
        BEGIN
          PERFORM public.enqueue_notification(
            NEW.user_id,
            'attendee',
            'purchase_completed',
            '🎉 ¡Compra completada!',
            '¡Listo, ' || v_name || '! Tu compra para "' || v_event.title || '" se confirmó. Tienes 1 entrada lista en Mis Entradas.',
            'high',
            jsonb_build_object(
              'event_id', v_event.id::text,
              'payment_intent_id', NEW.stripe_payment_intent_id,
              'listing_id', v_listing.id::text,
              'ticket_id', v_listing.ticket_id::text
            )
          );
        EXCEPTION WHEN others THEN
          NULL;
        END;

        BEGIN
          PERFORM public.enqueue_notification(
            v_listing.seller_id,
            'attendee',
            'resale_sold',
            '💸 Entrada vendida',
            'Has vendido tu entrada de "' || v_event.title || '". El dinero se ha añadido a tu wallet.',
            'high',
            jsonb_build_object(
              'event_id', v_event.id::text,
              'buyer_id', NEW.user_id::text,
              'listing_id', v_listing.id::text,
              'ticket_id', v_listing.ticket_id::text,
              'payment_intent_id', NEW.stripe_payment_intent_id
            )
          );
        EXCEPTION WHEN others THEN
          NULL;
        END;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_fulfilled_notifications ON public.payment_transactions;
CREATE TRIGGER trg_payment_fulfilled_notifications
AFTER UPDATE ON public.payment_transactions
FOR EACH ROW
EXECUTE FUNCTION public.handle_payment_fulfilled_notifications();

NOTIFY pgrst, 'reload schema';
