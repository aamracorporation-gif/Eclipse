-- One-time restore into the empty, seven-table Eclipse Staging project only.
-- psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/baselines/restore-staging.sql
-- Never run through the historical db-push migration chain.
BEGIN;
DO $guard$ DECLARE r record; n bigint; BEGIN
IF current_database() <> 'postgres' THEN RAISE EXCEPTION 'Unexpected database'; END IF;
IF to_regnamespace('eclipse_prebaseline') IS NOT NULL THEN RAISE EXCEPTION 'Backup schema already exists'; END IF;
IF (select count(*) from pg_tables where schemaname='public') <> 7 THEN RAISE EXCEPTION 'Unexpected staging table count'; END IF;
IF EXISTS (SELECT 1 FROM auth.users) THEN RAISE EXCEPTION 'Staging has users'; END IF;
FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP EXECUTE format('SELECT count(*) FROM public.%I',r.tablename) INTO n; IF n<>0 THEN RAISE EXCEPTION 'Nonempty table %',r.tablename; END IF; END LOOP;
END $guard$;
ALTER SCHEMA public RENAME TO eclipse_prebaseline;
REVOKE ALL ON SCHEMA eclipse_prebaseline FROM PUBLIC, anon, authenticated, service_role;
CREATE SCHEMA public AUTHORIZATION postgres;
GRANT USAGE ON SCHEMA public TO postgres,anon,authenticated,service_role;
GRANT ALL ON SCHEMA public TO postgres,service_role;

\ir appfest-schema-20260921.sql
\ir ../migrations/20260920104448_repair_resale_credit_and_ticket_transfer.sql
\ir ../migrations/20260920112000_resale_refund_statuses.sql
\ir ../migrations/20260920120000_atomic_resale_refund_decision.sql
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
CREATE TRIGGER on_auth_user_created_link_worker AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.link_worker_profile();

\ir ../migrations/20260921224131_harden_staging_archive.sql
\ir ../migrations/20260921224229_restrict_signup_roles_and_resale_validation.sql
\ir ../migrations/20260921224553_align_primary_ticket_qr.sql
\ir ../migrations/20260921224725_prevent_signup_admin_role.sql
\ir ../migrations/20260922130423_fulfill_vip_card_atomically.sql
NOTIFY pgrst, 'reload schema';
COMMIT;
