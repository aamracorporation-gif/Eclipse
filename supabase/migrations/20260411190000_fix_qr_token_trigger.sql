-- Drop the trigger that inserts an invalid text UUID
DROP TRIGGER IF EXISTS ensure_qr_token ON public.tickets;

-- Drop the function
DROP FUNCTION IF EXISTS public.generate_ticket_qr_token();

-- Ensure qr_token has the correct default
ALTER TABLE public.tickets ALTER COLUMN qr_token SET DEFAULT gen_random_uuid();

NOTIFY pgrst, 'reload schema';
