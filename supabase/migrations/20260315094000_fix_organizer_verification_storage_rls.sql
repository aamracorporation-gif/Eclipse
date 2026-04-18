-- Fix Storage RLS policies for organizer verification uploads

INSERT INTO storage.buckets (id, name, public)
VALUES ('organizer_verification', 'organizer_verification', false)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  BEGIN
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Organizer verification: read own or admin" ON storage.objects;
    CREATE POLICY "Organizer verification: read own or admin"
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
      bucket_id = 'organizer_verification'
      AND (
        auth.uid() = owner
        OR auth.uid()::text = (storage.foldername(name))[1]
        OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
      )
    );

    DROP POLICY IF EXISTS "Organizer verification: upload to own folder" ON storage.objects;
    CREATE POLICY "Organizer verification: upload to own folder"
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
      bucket_id = 'organizer_verification'
      AND auth.uid()::text = (storage.foldername(name))[1]
    );

    DROP POLICY IF EXISTS "Organizer verification: update own or admin" ON storage.objects;
    CREATE POLICY "Organizer verification: update own or admin"
    ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (
      bucket_id = 'organizer_verification'
      AND (
        auth.uid() = owner
        OR auth.uid()::text = (storage.foldername(name))[1]
        OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
      )
    )
    WITH CHECK (
      bucket_id = 'organizer_verification'
      AND (
        auth.uid() = owner
        OR auth.uid()::text = (storage.foldername(name))[1]
        OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
      )
    );

    DROP POLICY IF EXISTS "Organizer verification: delete own or admin" ON storage.objects;
    CREATE POLICY "Organizer verification: delete own or admin"
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
      bucket_id = 'organizer_verification'
      AND (
        auth.uid() = owner
        OR auth.uid()::text = (storage.foldername(name))[1]
        OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
      )
    );
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
END $$;

NOTIFY pgrst, 'reload schema';
