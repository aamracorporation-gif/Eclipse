-- Migration to add wallet_added column to tickets table
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS wallet_added boolean DEFAULT false;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS wallet_pass_id text; -- Optional, for tracking specific pass objects

-- Trigger to notify wallet update when ticket status changes
CREATE OR REPLACE FUNCTION public.handle_ticket_wallet_update()
RETURNS trigger AS $$
BEGIN
  -- If ticket is used or cancelled, and it was added to wallet
  IF (OLD.status IS DISTINCT FROM NEW.status OR OLD.scanned_at IS DISTINCT FROM NEW.scanned_at) 
     AND NEW.wallet_added = true THEN
    -- In a real scenario, this would trigger an Edge Function to push update to Apple/Google
    -- For now we just log it or notify the system
    PERFORM public.notify(NEW.user_id, 'attendee', 'wallet_updated', '📲 Tu entrada en la Wallet se ha actualizado.');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_ticket_wallet_update ON public.tickets;
CREATE TRIGGER on_ticket_wallet_update
  AFTER UPDATE ON public.tickets
  FOR EACH ROW EXECUTE PROCEDURE public.handle_ticket_wallet_update();

-- Update RLS if needed (already public/authenticated should be fine)
NOTIFY pgrst, 'reload schema';
