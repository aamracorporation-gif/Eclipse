INSERT INTO storage.buckets (id, name, public)
VALUES ('night_mode', 'night_mode', true)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS "night_mode_public_read" ON storage.objects';
    EXECUTE $policy$
      CREATE POLICY "night_mode_public_read"
      ON storage.objects
      FOR SELECT
      USING (bucket_id = 'night_mode')
    $policy$;

    EXECUTE 'DROP POLICY IF EXISTS "night_mode_insert_own" ON storage.objects';
    EXECUTE $policy$
      CREATE POLICY "night_mode_insert_own"
      ON storage.objects
      FOR INSERT
      TO authenticated
      WITH CHECK (
        bucket_id = 'night_mode'
        AND auth.uid()::text = COALESCE((storage.foldername(name))[2], '')
      )
    $policy$;

    EXECUTE 'DROP POLICY IF EXISTS "night_mode_update_own" ON storage.objects';
    EXECUTE $policy$
      CREATE POLICY "night_mode_update_own"
      ON storage.objects
      FOR UPDATE
      TO authenticated
      USING (
        bucket_id = 'night_mode'
        AND auth.uid()::text = COALESCE((storage.foldername(name))[2], '')
      )
      WITH CHECK (
        bucket_id = 'night_mode'
        AND auth.uid()::text = COALESCE((storage.foldername(name))[2], '')
      )
    $policy$;

    EXECUTE 'DROP POLICY IF EXISTS "night_mode_delete_own" ON storage.objects';
    EXECUTE $policy$
      CREATE POLICY "night_mode_delete_own"
      ON storage.objects
      FOR DELETE
      TO authenticated
      USING (
        bucket_id = 'night_mode'
        AND auth.uid()::text = COALESCE((storage.foldername(name))[2], '')
      )
    $policy$;
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
END $$;

NOTIFY pgrst, 'reload schema';
