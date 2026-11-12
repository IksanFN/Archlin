#!/bin/bash
# Restores one backup into the running Postgres and the files volume. Runs as root inside the restore service.
# Usage: restore-inside.sh <backup-path-inside-container>; the age identity is mounted at /run/age/key.
set -euo pipefail

: "${RESTORE_ADMIN_URL:?RESTORE_ADMIN_URL is required}"
if [ $# -ne 1 ]; then
  echo "usage: restore-inside.sh <backup-file>" >&2
  exit 64
fi

stage=verify
report() {
  local status=$?
  if [ "$status" -ne 0 ]; then
    if [ "$stage" = verify ]; then
      echo "Restore dibatalkan (exit $status). Database dan file belum disentuh." >&2
    else
      echo "Restore gagal di tahap '$stage' (exit $status). Database mungkin kosong; ulangi restore dengan backup yang sama." >&2
    fi
  fi
}
trap report EXIT

work=/work/restore
rm -rf "$work"
mkdir -p "$work"

age -d -i /run/age/key "$1" | tar -C "$work" -xf -

for artifact in db.dump files.tar; do
  expected=$(jq -r --arg name "$artifact" '.artifacts[$name] // empty' "$work/manifest.json")
  actual=$(sha256sum "$work/$artifact" | cut -d' ' -f1)
  if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
    echo "Checksum $artifact tidak cocok dengan manifest." >&2
    exit 2
  fi
done

stage=database
psql "$RESTORE_ADMIN_URL" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS cortex WITH (FORCE)"
psql "$RESTORE_ADMIN_URL" -v ON_ERROR_STOP=1 -v db_name=cortex -f /opt/archlin/provision-database.sql
# The superuser connection keeps owners, policies and grants as they were in the dump.
pg_restore --exit-on-error --dbname="${RESTORE_ADMIN_URL%/*}/cortex" "$work/db.dump"

stage=files
find /data/files -mindepth 1 -delete
tar -C /data/files -xf "$work/files.tar"
chown -R 1000:1000 /data/files

stage=done
jq -r '"Backup dipulihkan: dibuat \(.createdAt), \(.migrations | length) migrasi."' "$work/manifest.json"
