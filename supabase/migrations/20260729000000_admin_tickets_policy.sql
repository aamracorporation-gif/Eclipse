-- Allow admin role to SELECT and UPDATE all tickets (bypasses user-only RLS)
-- Admin is identified by role = 'admin' in profiles table

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'tickets' AND policyname = 'Admin can view all tickets'
  ) THEN
    CREATE POLICY "Admin can view all tickets"
      ON tickets FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM profiles
          WHERE id = auth.uid()
            AND (role = 'admin' OR email = current_setting('app.admin_email', true))
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'tickets' AND policyname = 'Admin can update all tickets'
  ) THEN
    CREATE POLICY "Admin can update all tickets"
      ON tickets FOR UPDATE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM profiles
          WHERE id = auth.uid()
            AND (role = 'admin' OR email = current_setting('app.admin_email', true))
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM profiles
          WHERE id = auth.uid()
            AND (role = 'admin' OR email = current_setting('app.admin_email', true))
        )
      );
  END IF;
END $$;
