-- Run as superuser against any database (psql variable: db_name). Creates the database and its baseline privileges.
CREATE DATABASE :"db_name" OWNER cortex_migrator;
\connect :"db_name"
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
REVOKE ALL ON DATABASE :"db_name" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db_name" TO cortex_app, cortex_backup;
ALTER SCHEMA public OWNER TO cortex_migrator;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO cortex_app, cortex_identity, cortex_backup;
GRANT CREATE ON SCHEMA public TO cortex_identity;
