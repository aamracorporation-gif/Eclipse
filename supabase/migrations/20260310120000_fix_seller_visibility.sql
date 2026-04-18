-- Fix Seller Visibility: Allow sellers to see their sold tickets
-- This is necessary for the profile "Mis Entradas Vendidas" section to show ticket details.

-- 1. Add policy to 'tickets' table
-- Allow sellers to view tickets they have listed (active or sold) even if they don't own them anymore
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'tickets' 
    AND policyname = 'Sellers can view their listed tickets'
  ) THEN
    CREATE POLICY "Sellers can view their listed tickets" 
    ON tickets 
    FOR SELECT 
    USING (
      EXISTS (
        SELECT 1 FROM resale_listings 
        WHERE resale_listings.ticket_id = tickets.id 
        AND resale_listings.seller_id = auth.uid()
      )
    );
  END IF;
END $$;
