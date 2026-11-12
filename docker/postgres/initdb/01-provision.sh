#!/bin/bash
# Runs once by the postgres image entrypoint on an empty data directory.
# The SQL lives in /opt/archlin (not in initdb) so the entrypoint cannot run it a second time without variables.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v migrator_pw="$CORTEX_MIGRATOR_PASSWORD" \
  -v app_pw="$CORTEX_APP_PASSWORD" \
  -v backup_pw="$CORTEX_BACKUP_PASSWORD" \
  -f /opt/archlin/provision-roles.sql

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v db_name=cortex \
  -f /opt/archlin/provision-database.sql
