DROP TRIGGER IF EXISTS trg_ticket_insert_notifications ON public.tickets;

CREATE OR REPLACE FUNCTION public.handle_ticket_insert_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';

