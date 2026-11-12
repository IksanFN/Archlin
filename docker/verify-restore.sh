#!/bin/bash
# Usage (from cortex/, Git Bash on Windows): bash docker/verify-restore.sh <age-identity-file> --confirm-destroy
# Proves a backup restores into an empty cluster. It DELETES the stack's pgdata and files volumes in between,
# so the stack must be running and its data is replaced by the restored copy.
set -euo pipefail
export MSYS_NO_PATHCONV=1

if [ $# -ne 2 ] || [ "$2" != "--confirm-destroy" ]; then
  echo "usage: verify-restore.sh <age-identity-file> --confirm-destroy" >&2
  echo "Volume archlin_pgdata dan archlin_files akan dihapus lalu dipulihkan dari backup baru." >&2
  exit 64
fi
identity=$1

compose=(docker compose -f docker/compose.yml --env-file .env)
snapshot_sql="select (select count(*) from users) || ':' || (select count(*) from security_events) || ':' || (select string_agg(name, ',' order by name) from kysely_migration)"
snapshot() {
  "${compose[@]}" exec -T postgres psql -U postgres -d cortex -At -c "$snapshot_sql"
}

before=$(snapshot)
echo "Sebelum: $before"

"${compose[@]}" run --rm --entrypoint backup.sh backup
latest=$("${compose[@]}" run --rm --entrypoint sh backup -c 'ls -1 /backups | sort | tail -n 1' | tr -d '\r')
others=$("${compose[@]}" run --rm --entrypoint sh backup -c 'ls -1 /backups | grep -v "\.tar\.age$" || true' | tr -d '\r')
if [ -n "$others" ]; then
  echo "/backups berisi file selain *.tar.age: $others" >&2
  exit 1
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
tmp_host=$(cd "$tmp" && (pwd -W 2>/dev/null || pwd))
"${compose[@]}" run --rm --entrypoint cp -v "$tmp_host:/out" backup "/backups/$latest" /out/

"${compose[@]}" down
docker volume rm archlin_pgdata archlin_files
"${compose[@]}" up -d --wait postgres

bash docker/restore.sh "$tmp/$latest" "$identity"

after=$(snapshot)
echo "Sesudah: $after"
if [ "$before" != "$after" ]; then
  echo "Snapshot berbeda setelah restore." >&2
  exit 1
fi
curl -fsS "http://localhost:${ARCHLIN_STACK_PORT:-8080}/health" > /dev/null
echo "Restore terverifikasi. Uji login dengan TOTP secara manual."
