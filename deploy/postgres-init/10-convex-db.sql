-- Create the database that self-hosted Convex expects (BL-0008).
--
-- The Convex backend does NOT create its own database. Given a POSTGRES_URL
-- server URL it connects to a database named `convex_self_hosted` and exits
-- immediately if that database is missing:
--
--   ERROR common::errors: db error: FATAL: database "convex_self_hosted"
--   does not exist
--
-- Postgres runs everything in /docker-entrypoint-initdb.d exactly once, on a
-- first boot against an EMPTY data directory. Adding this file to a Postgres
-- that already has data does nothing — create the database by hand instead:
--
--   docker compose exec postgres \
--     psql -U pantry -d postgres -c 'CREATE DATABASE convex_self_hosted'
--
-- \gexec makes this a no-op when the database already exists, so the file is
-- also safe to apply by hand.
SELECT 'CREATE DATABASE convex_self_hosted'
WHERE NOT EXISTS (
  SELECT FROM pg_database WHERE datname = 'convex_self_hosted'
)\gexec
