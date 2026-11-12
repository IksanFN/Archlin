#!/bin/bash
# One encrypted backup: database dump, uploaded files and a manifest with checksums, sealed to the age public key.
# The private key never reaches this container, so a stolen backup volume cannot be read.
set -euo pipefail

: "${BACKUP_DATABASE_URL:?BACKUP_DATABASE_URL is required}"
: "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT is required}"
: "${BACKUP_RETENTION_DAYS:?BACKUP_RETENTION_DAYS is required}"

ts=$(date -u +%Y%m%dT%H%M%SZ)
work=/work/$ts
mkdir -p "$work"
trap 'rm -rf "$work"' EXIT

pg_dump --format=custom --dbname="$BACKUP_DATABASE_URL" --file="$work/db.dump"
tar -C /data/files -cf "$work/files.tar" .

migrations=$(psql "$BACKUP_DATABASE_URL" -At -c "select coalesce(json_agg(name order by name), '[]'::json) from kysely_migration")

jq -n \
  --arg createdAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg appVersion "${APP_VERSION:-dev}" \
  --argjson migrations "$migrations" \
  --arg dbSha "$(sha256sum "$work/db.dump" | cut -d' ' -f1)" \
  --arg filesSha "$(sha256sum "$work/files.tar" | cut -d' ' -f1)" \
  '{format: 1, createdAt: $createdAt, appVersion: $appVersion, migrations: $migrations, artifacts: {"db.dump": $dbSha, "files.tar": $filesSha}}' \
  > "$work/manifest.json"

final=/backups/archlin-$ts.tar.age
tar -C "$work" -cf - manifest.json db.dump files.tar | age -r "$BACKUP_AGE_RECIPIENT" > "$final.partial"
mv "$final.partial" "$final"

# Pruning only after a good backup exists, so a failing run never eats the older generations.
find /backups -name 'archlin-*.tar.age' -mtime +"$BACKUP_RETENTION_DAYS" -delete
rm -f /backups/*.partial

echo "$final"
