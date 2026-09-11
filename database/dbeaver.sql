-- ASOC Postgres for DBeaver
-- Driver: PostgreSQL
-- Host: localhost
-- Port: 5432
-- Database: asoc
-- Username: asoc
-- Password: asoc
-- SSL: disable (local docker-compose)
--
-- Start the database:
--   docker compose up -d postgres
--   npm run db:migrate
-- Then in DBeaver: New Connection → PostgreSQL → those fields → Test Connection.
-- Canonical objects are in database/schema.sql (loads, holders, security_sessions, audit_logs).

SELECT current_database() AS database, current_user AS dbeaver_user, now() AS connected_at;
