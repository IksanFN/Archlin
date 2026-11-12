#!/bin/bash
# Runs backup.sh every day at BACKUP_AT (in the container's TZ). A failed run is logged and the loop keeps going.
set -uo pipefail

at=${BACKUP_AT:-02:00}

log() {
  jq -nc "$@"
}

# Refuse to start without a recipient: a stack that silently takes no backups is worse than one that will not start.
if [ -z "${BACKUP_AGE_RECIPIENT:-}" ]; then
  log --arg reason "BACKUP_AGE_RECIPIENT is empty" '{msg: "backup not configured", reason: $reason}' >&2
  exit 1
fi

while true; do
  now=$(date +%s)
  next=$(date -d "today $at" +%s)
  if [ "$next" -le "$now" ]; then
    next=$(date -d "tomorrow $at" +%s)
  fi
  sleep $((next - now))

  if file=$(backup.sh); then
    log --arg file "$file" '{msg: "backup finished", file: $file}'
  else
    log --argjson exit "$?" '{msg: "backup failed", exit: $exit}'
  fi
done
