-- Run once per cluster as superuser (psql variables: migrator_pw, app_pw, backup_pw).
CREATE ROLE cortex_migrator LOGIN PASSWORD :'migrator_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE cortex_app LOGIN PASSWORD :'app_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
CREATE ROLE cortex_identity NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE cortex_backup LOGIN PASSWORD :'backup_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
GRANT pg_read_all_data TO cortex_backup;
-- Migrations need membership to hand gateway functions to cortex_identity; runtime roles never get it.
GRANT cortex_identity TO cortex_migrator;
