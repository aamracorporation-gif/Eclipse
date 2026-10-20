-- Initial additive install only. Review the exact existing project before applying.
-- No public/auth/storage/Eclipse data is rewritten or copied.
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='rondiqo') THEN
    RAISE EXCEPTION 'rondiqo already exists: inspect before applying initial migration';
  END IF;
END $$;
-- Private RONDIQO schema. Remote application requires explicit target approval.
CREATE SCHEMA IF NOT EXISTS rondiqo;
CREATE TABLE IF NOT EXISTS rondiqo.profiles (
  id uuid PRIMARY KEY, email text NOT NULL UNIQUE, name text NOT NULL,
  role text NOT NULL DEFAULT 'player' CHECK (role IN ('player','admin')),
  city text NOT NULL DEFAULT 'Sevilla', level text NOT NULL DEFAULT 'intermediate',
  adult_attested boolean NOT NULL, terms_version text NOT NULL, marketing_opt_in boolean NOT NULL DEFAULT false,
  suspended boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rondiqo.credentials (user_id uuid PRIMARY KEY REFERENCES rondiqo.profiles(id), password_hash text NOT NULL);
CREATE TABLE IF NOT EXISTS rondiqo.sessions (token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES rondiqo.profiles(id), expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS rondiqo.organizations (
  id uuid PRIMARY KEY, name text NOT NULL, owner_id uuid NOT NULL REFERENCES rondiqo.profiles(id),
  city text NOT NULL, verified boolean NOT NULL DEFAULT false, stripe_account text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rondiqo.org_members (
  org_id uuid NOT NULL REFERENCES rondiqo.organizations(id), user_id uuid NOT NULL REFERENCES rondiqo.profiles(id),
  role text NOT NULL CHECK (role IN ('owner','manager','referee','checkin')), PRIMARY KEY(org_id,user_id)
);
CREATE TABLE IF NOT EXISTS rondiqo.teams (
  id uuid PRIMARY KEY, name text NOT NULL, sport text NOT NULL, captain_id uuid NOT NULL REFERENCES rondiqo.profiles(id),
  invite_hash text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rondiqo.team_members (
  team_id uuid NOT NULL REFERENCES rondiqo.teams(id), user_id uuid NOT NULL REFERENCES rondiqo.profiles(id),
  PRIMARY KEY(team_id,user_id)
);
CREATE TABLE IF NOT EXISTS rondiqo.competitions (
  id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES rondiqo.organizations(id), title text NOT NULL,
  sport text NOT NULL CHECK(sport IN ('padel','football7','basket3x3','tennis')),
  format text NOT NULL CHECK(format IN ('knockout','league','challenge')), entry_mode text NOT NULL CHECK(entry_mode IN ('team','individual')),
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','open','running','completed','cancelled')),
  city text NOT NULL, venue text NOT NULL, starts_at timestamptz NOT NULL, registration_closes_at timestamptz NOT NULL,
  capacity integer NOT NULL CHECK(capacity BETWEEN 2 AND 128), min_roster integer NOT NULL CHECK(min_roster BETWEEN 1 AND 20),
  price_cents integer NOT NULL CHECK(price_cents BETWEEN 0 AND 100000), currency text NOT NULL DEFAULT 'eur' CHECK(currency='eur'),
  level text NOT NULL, description text NOT NULL, rules text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1,
  CHECK(registration_closes_at <= starts_at)
);
CREATE TABLE IF NOT EXISTS rondiqo.registrations (
  id uuid PRIMARY KEY, competition_id uuid NOT NULL REFERENCES rondiqo.competitions(id), user_id uuid NOT NULL REFERENCES rondiqo.profiles(id),
  team_id uuid REFERENCES rondiqo.teams(id), display_name text NOT NULL, roster jsonb NOT NULL,
  status text NOT NULL CHECK(status IN ('pending','confirmed','waitlisted','cancelled','expired','refund_pending','refunded')),
  amount_cents integer NOT NULL CHECK(amount_cents>=0), provider text NOT NULL CHECK(provider IN ('free','simulated','stripe_test')),
  checkout_id text UNIQUE, payment_intent text UNIQUE, qr_token text NOT NULL UNIQUE,
  expires_at timestamptz, checked_in_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS active_player_registration ON rondiqo.registrations(competition_id,user_id) WHERE status IN ('pending','confirmed','waitlisted','refund_pending');
CREATE UNIQUE INDEX IF NOT EXISTS active_team_registration ON rondiqo.registrations(competition_id,team_id) WHERE status IN ('pending','confirmed','waitlisted','refund_pending');
CREATE TABLE IF NOT EXISTS rondiqo.matches (
  id uuid PRIMARY KEY, competition_id uuid NOT NULL REFERENCES rondiqo.competitions(id), round integer NOT NULL, position integer NOT NULL,
  home uuid REFERENCES rondiqo.registrations(id), away uuid REFERENCES rondiqo.registrations(id),
  status text NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','proposed','disputed','confirmed','bye')),
  score jsonb, winner uuid REFERENCES rondiqo.registrations(id), proposed_by uuid REFERENCES rondiqo.profiles(id),
  starts_at timestamptz, court text, duration_minutes integer NOT NULL DEFAULT 60,
  version integer NOT NULL DEFAULT 1, UNIQUE(competition_id,round,position)
);
CREATE TABLE IF NOT EXISTS rondiqo.audit (
  id uuid PRIMARY KEY, actor_id uuid, action text NOT NULL, resource_id text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rondiqo.notifications (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES rondiqo.profiles(id), title text NOT NULL,
  message text NOT NULL, read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rondiqo.webhook_events (id text PRIMARY KEY, type text NOT NULL, processed_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS rondiqo.idempotency (
  actor_id uuid NOT NULL REFERENCES rondiqo.profiles(id), key text NOT NULL, request_hash text NOT NULL, response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(actor_id,key)
);
CREATE TABLE IF NOT EXISTS rondiqo.refunds (
  id uuid PRIMARY KEY, registration_id uuid NOT NULL UNIQUE REFERENCES rondiqo.registrations(id),
  status text NOT NULL CHECK(status IN ('pending','completed','failed')), provider_ref text, reason text NOT NULL
);
CREATE INDEX IF NOT EXISTS competition_discovery ON rondiqo.competitions(status,city,sport,starts_at);
CREATE INDEX IF NOT EXISTS registration_competition ON rondiqo.registrations(competition_id,status);
CREATE INDEX IF NOT EXISTS matches_competition ON rondiqo.matches(competition_id,round,position);
CREATE INDEX IF NOT EXISTS notifications_user ON rondiqo.notifications(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS memberships_user ON rondiqo.org_members(user_id,org_id,role);
CREATE INDEX IF NOT EXISTS team_members_user ON rondiqo.team_members(user_id,team_id);
CREATE INDEX IF NOT EXISTS competition_organization ON rondiqo.competitions(org_id,starts_at);
CREATE INDEX IF NOT EXISTS registration_roster ON rondiqo.registrations USING gin(roster);
-- Private backend-only schema. Supabase anon/authenticated get NO grants.
-- Authorization is enforced by the authenticated application service. No public views.
REVOKE ALL ON SCHEMA rondiqo FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA rondiqo FROM PUBLIC;
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='rondiqo' LOOP
    EXECUTE format('ALTER TABLE rondiqo.%I ENABLE ROW LEVEL SECURITY',t.tablename);
  END LOOP;
END $$;

-- Dedicated backend identity; no secret or login is created by this migration.
-- The authenticated application server checks per-user organization/team permissions.
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='rondiqo_backend') THEN
    CREATE ROLE rondiqo_backend NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  ELSE
    RAISE EXCEPTION 'rondiqo_backend already exists: review privileges before installation';
  END IF;
END $$;
GRANT USAGE ON SCHEMA rondiqo TO rondiqo_backend;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA rondiqo TO rondiqo_backend;
DO $$ DECLARE t record; r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA rondiqo FROM %I',r);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA rondiqo FROM %I',r);
    END IF;
  END LOOP;
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='rondiqo' LOOP
    EXECUTE format('CREATE POLICY backend_access ON rondiqo.%I FOR ALL TO rondiqo_backend USING (true) WITH CHECK (true)',t.tablename);
  END LOOP;
END $$;
COMMENT ON SCHEMA rondiqo IS 'RONDIQO amateur sports; isolated from Eclipse public tables; backend-only access';
