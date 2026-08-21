-- Database role separation (doc 21 §21.3, SENS-SEC-015).
--
-- Applied by `npm run db:roles` with the owner connection. Idempotent.
--
--   senslab_owner     owns the objects. Never used for a connection by anything.
--   senslab_migrator  full DDL. Used only by the migration step, in its own deploy stage.
--   senslab_app       the runtime role. SELECT/INSERT/UPDATE/DELETE and nothing else:
--                     no CREATE, no DROP, no TRUNCATE, no DDL of any kind.
--   senslab_readonly  SELECT on the support views only. For analytics and support.
--
-- Passwords here are development values. Production credentials come from the platform's
-- secret store and are never committed.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'senslab_migrator') THEN
    CREATE ROLE senslab_migrator LOGIN PASSWORD 'senslab_migrator_password';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'senslab_app') THEN
    CREATE ROLE senslab_app LOGIN PASSWORD 'senslab_app_password';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'senslab_readonly') THEN
    CREATE ROLE senslab_readonly LOGIN PASSWORD 'senslab_readonly_password';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE senslab TO senslab_migrator, senslab_app, senslab_readonly;

-- The migrator needs DDL on the schema.
GRANT USAGE, CREATE ON SCHEMA public TO senslab_migrator;

-- The application may use the schema but may not create in it.
GRANT USAGE ON SCHEMA public TO senslab_app, senslab_readonly;
REVOKE CREATE ON SCHEMA public FROM senslab_app, senslab_readonly, PUBLIC;

-- Data privileges for the runtime role on everything that exists now...
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO senslab_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO senslab_app;

-- ...and on everything the migrator creates in future.
ALTER DEFAULT PRIVILEGES FOR ROLE senslab_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO senslab_app;
ALTER DEFAULT PRIVILEGES FOR ROLE senslab_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO senslab_app;
ALTER DEFAULT PRIVILEGES FOR ROLE senslab_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO senslab_app;
ALTER DEFAULT PRIVILEGES FOR ROLE senslab_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO senslab_app;

-- The read-only role sees the support views, not the base tables: no email column, no hashes.
GRANT SELECT ON v_session_overview, v_recommendation_summary, v_session_quality
  TO senslab_readonly;

-- Statement and transaction timeouts at role level, so a connection that forgets to set them
-- still cannot hold a transaction open (doc 21 §21.4).
ALTER ROLE senslab_app SET statement_timeout = '10s';
ALTER ROLE senslab_app SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE senslab_readonly SET statement_timeout = '30s';
ALTER ROLE senslab_migrator SET lock_timeout = '5s';
