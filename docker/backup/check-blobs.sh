#!/bin/bash
# Usage: check-blobs.sh <files-root> [--expect -]
# A blob's file name is its sha256, so a restored volume is proven by hashing every file and comparing it with its name.
# With --expect -, stdin lists the keys the database knows (blobs/<owner>/<aa>/<sha256>, one per line); each must exist.
# Files the database does not know (an upload that rolled back, not yet swept) are hashed too but are not an error.
# Prints "blobs-ok <count>" (expected keys found, or files checked without --expect) and exits 0, or one line per
# problem ("blob-mismatch <path>", "blob-missing <key>") and exits 3.
set -euo pipefail

if [ $# -ne 1 ] && { [ $# -ne 3 ] || [ "$2" != "--expect" ] || [ "$3" != "-" ]; }; then
  echo "usage: check-blobs.sh <files-root> [--expect -]" >&2
  exit 64
fi
root=${1%/}

count=0
bad=0
while IFS= read -r -d '' file; do
  count=$((count + 1))
  actual=$(sha256sum "$file" | cut -d' ' -f1)
  if [ "$actual" != "$(basename "$file")" ]; then
    echo "blob-mismatch ${file#"$root"/}"
    bad=$((bad + 1))
  fi
done < <(find "$root/blobs" -mindepth 3 -maxdepth 3 -type f -print0 2>/dev/null | sort -z)

if [ $# -eq 3 ]; then
  count=0
  while IFS= read -r key || [ -n "$key" ]; do
    key=${key%$'\r'}
    [ -z "$key" ] && continue
    case "$key" in
      blobs/*/*/*) ;;
      *) echo "blob-missing $key"; bad=$((bad + 1)); continue ;;
    esac
    if [ -f "$root/$key" ]; then
      count=$((count + 1))
    else
      echo "blob-missing $key"
      bad=$((bad + 1))
    fi
  done
fi

if [ "$bad" -ne 0 ]; then
  exit 3
fi
echo "blobs-ok $count"
