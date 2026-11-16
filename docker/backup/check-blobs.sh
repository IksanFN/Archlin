#!/bin/bash
# Usage: check-blobs.sh <files-root>
# A blob's file name is its sha256, so a restored volume is proven by hashing every file and comparing it with its name.
# Prints "blobs-ok <count>" and exits 0, or "blob-mismatch <path>" per wrong file and exits 3.
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "usage: check-blobs.sh <files-root>" >&2
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

if [ "$bad" -ne 0 ]; then
  exit 3
fi
echo "blobs-ok $count"
