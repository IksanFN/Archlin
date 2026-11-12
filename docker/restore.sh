#!/bin/bash
# Usage (from cortex/, Git Bash on Windows): bash docker/restore.sh <backup-file> <age-identity-file>
# Stops the app, restores the backup into the running Postgres and files volume, then starts the app again.
set -euo pipefail
# Stops Git Bash from rewriting container paths such as /restore-in into Windows paths.
export MSYS_NO_PATHCONV=1

if [ $# -ne 2 ]; then
  echo "usage: restore.sh <backup-file> <age-identity-file>" >&2
  exit 64
fi
for file in "$1" "$2"; do
  [ -f "$file" ] || { echo "File tidak ditemukan: $file" >&2; exit 66; }
done

host_dir() {
  (cd "$(dirname "$1")" && (pwd -W 2>/dev/null || pwd))
}

backup_dir=$(host_dir "$1")
backup_name=$(basename "$1")
identity_path="$(host_dir "$2")/$(basename "$2")"

compose=(docker compose -f docker/compose.yml --env-file .env)

"${compose[@]}" stop web worker backup
"${compose[@]}" --profile ops run --rm \
  -v "$backup_dir:/restore-in:ro" \
  -v "$identity_path:/run/age/key:ro" \
  restore "/restore-in/$backup_name"
"${compose[@]}" up -d --wait migrate web worker backup
