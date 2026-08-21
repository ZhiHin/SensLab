-- Extensions required before any table is created.
-- Idempotent and applied by scripts/migrate.ts ahead of the generated migrations.

-- citext: case-insensitive text, used for the email column so that uniqueness is
-- case-insensitive in the column type rather than at every call site (doc 20 §20.3).
CREATE EXTENSION IF NOT EXISTS citext;

-- pgcrypto: gen_random_uuid() as a fallback. UUIDs are normally generated application-side
-- as v7 for index locality (doc 20 §20.1).
CREATE EXTENSION IF NOT EXISTS pgcrypto;
