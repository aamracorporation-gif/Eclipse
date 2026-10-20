-- Additive release controls. Existing sports and Eclipse records are preserved.
ALTER TABLE rondiqo.registrations DROP CONSTRAINT registrations_provider_check;
ALTER TABLE rondiqo.registrations ADD CONSTRAINT registrations_provider_check CHECK(provider IN ('free','simulated','stripe_test','stripe_live'));
CREATE TABLE IF NOT EXISTS rondiqo.rate_limits(
 bucket text NOT NULL,window_start timestamptz NOT NULL,count integer NOT NULL,expires_at timestamptz NOT NULL,
 PRIMARY KEY(bucket,window_start));
CREATE INDEX IF NOT EXISTS rate_limits_expiry ON rondiqo.rate_limits(expires_at);
CREATE TABLE IF NOT EXISTS rondiqo.deletion_requests(
 user_id uuid PRIMARY KEY REFERENCES rondiqo.profiles(id),status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed')),
 created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz);
ALTER TABLE rondiqo.rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE rondiqo.deletion_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON rondiqo.rate_limits,rondiqo.deletion_requests FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON rondiqo.rate_limits,rondiqo.deletion_requests TO rondiqo_backend;
CREATE POLICY backend_access ON rondiqo.rate_limits FOR ALL TO rondiqo_backend USING(true) WITH CHECK(true);
CREATE POLICY backend_access ON rondiqo.deletion_requests FOR ALL TO rondiqo_backend USING(true) WITH CHECK(true);
