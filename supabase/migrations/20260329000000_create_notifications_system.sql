-- Notification System Table
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role text NOT NULL CHECK (role IN ('attendee', 'organizer', 'staff', 'admin')),
  type text NOT NULL,
  message text NOT NULL,
  read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Indices for performance
CREATE INDEX IF NOT EXISTS notifications_user_id_idx ON public.notifications (user_id);
CREATE INDEX IF NOT EXISTS notifications_read_idx ON public.notifications (read);

-- Enable RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Policies
DROP POLICY IF EXISTS "Users can view their own notifications" ON public.notifications;
CREATE POLICY "Users can view their own notifications"
ON public.notifications
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own notifications" ON public.notifications;
CREATE POLICY "Users can update their own notifications"
ON public.notifications
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Helper function to send notifications
CREATE OR REPLACE FUNCTION public.notify(
  p_user_id uuid,
  p_role text,
  p_type text,
  p_message text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.notifications (user_id, role, type, message)
  VALUES (p_user_id, p_role, p_type, p_message);
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify(uuid, text, text, text) TO authenticated, service_role;

-- Helper to mark all as read
CREATE OR REPLACE FUNCTION public.mark_all_notifications_read(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.notifications
  SET read = true
  WHERE user_id = p_user_id AND read = false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read(uuid) TO authenticated;

-- Trigger for worker assignment
CREATE OR REPLACE FUNCTION public.handle_worker_notification()
RETURNS trigger AS $$
BEGIN
  -- When a worker is linked to a user (status becomes active or inserted as active)
  IF (TG_OP = 'INSERT' AND NEW.status = 'active') OR (TG_OP = 'UPDATE' AND OLD.status = 'pending' AND NEW.status = 'active') THEN
    IF NEW.user_id IS NOT NULL THEN
      PERFORM public.notify(NEW.user_id, 'staff', 'event_assigned', '📋 Tienes un nuevo evento asignado para trabajar. Revisa los detalles.');
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_worker_active ON public.workers;
CREATE TRIGGER on_worker_active
  AFTER INSERT OR UPDATE ON public.workers
  FOR EACH ROW EXECUTE PROCEDURE public.handle_worker_notification();

-- Trigger for event modifications
CREATE OR REPLACE FUNCTION public.handle_event_updates_notification()
RETURNS trigger AS $$
BEGIN
  -- If event is modified (date or title)
  IF (OLD.event_date IS DISTINCT FROM NEW.event_date) OR (OLD.title IS DISTINCT FROM NEW.title) THEN
    -- Notify all attendees who bought a ticket for this event
    INSERT INTO public.notifications (user_id, role, type, message)
    SELECT DISTINCT user_id, 'attendee', 'event_modified', '🔁 Atención, hay cambios en el evento "' || NEW.title || '". Revisa los nuevos detalles para no perderte nada.'
    FROM public.tickets
    WHERE event_id = NEW.id AND status = 'valid';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_event_update ON public.events;
CREATE TRIGGER on_event_update
  AFTER UPDATE ON public.events
  FOR EACH ROW EXECUTE PROCEDURE public.handle_event_updates_notification();

-- Trigger for event cancellation (on delete)
CREATE OR REPLACE FUNCTION public.handle_event_delete_notification()
RETURNS trigger AS $$
BEGIN
  -- Notify all attendees who bought a ticket for this event
  INSERT INTO public.notifications (user_id, role, type, message)
  SELECT DISTINCT user_id, 'attendee', 'event_cancelled', '⚠️ El evento "' || OLD.title || '" ha sido cancelado. Tranquilo, estamos gestionando tu reembolso.'
  FROM public.tickets
  WHERE event_id = OLD.id AND status = 'valid';
  
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_event_delete ON public.events;
CREATE TRIGGER on_event_delete
  BEFORE DELETE ON public.events
  FOR EACH ROW EXECUTE PROCEDURE public.handle_event_delete_notification();

-- Reload schema cache
NOTIFY pgrst, 'reload schema';
