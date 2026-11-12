#!/bin/bash
# Usage: recreate-database.sh <name>. Drops and re-provisions an empty database (E2E reset, restore target).
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "usage: recreate-database.sh <name>" >&2
  exit 2
fi

dropdb --if-exists --force -U postgres "$1"
psql -v ON_ERROR_STOP=1 -U postgres --dbname postgres -v db_name="$1" -f /opt/archlin/provision-database.sql
