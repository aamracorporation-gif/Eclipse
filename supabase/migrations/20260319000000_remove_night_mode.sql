DROP POLICY IF EXISTS "night_mode_public_read" ON storage.objects;
DROP POLICY IF EXISTS "night_mode_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "night_mode_update_own" ON storage.objects;
DROP POLICY IF EXISTS "night_mode_delete_own" ON storage.objects;

DROP TABLE IF EXISTS public.event_media_engagement CASCADE;
DROP TABLE IF EXISTS public.event_live_streams CASCADE;
DROP TABLE IF EXISTS public.event_media CASCADE;

NOTIFY pgrst, 'reload schema';
