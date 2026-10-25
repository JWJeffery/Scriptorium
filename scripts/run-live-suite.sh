#!/usr/bin/env bash
# Starts the production build on 127.0.0.1:3100, runs every live check against it, then stops it.
# Needs: a built app (pnpm build), a migrated PostgreSQL database in DATABASE_URL, and (for the
# browser test) Chromium. The storage backend is whatever SCRIPTORIUM_STORAGE_BACKEND says, so run it
# once as-is for local disk and once with the S3 settings for object storage.
set -uo pipefail
cd "$(dirname "$0")/.."

export SCRIPTORIUM_AUTH_DISABLED=true SCRIPTORIUM_FAKE_EMBEDDINGS=1 SCRIPTORIUM_RATE_LIMITS_DISABLED=true
base=http://127.0.0.1:3100
log=next-server.log

(cd apps/web && exec node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3100) > "$log" 2>&1 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT

for _ in $(seq 1 40); do
  curl --fail --silent "$base/" > /dev/null && break
  sleep 1
done
if ! curl --fail --silent "$base/" > /dev/null; then cat "$log"; exit 1; fi

run() { SCRIPTORIUM_BASE_URL="$base" "$@" || { echo "FAILED: $*"; cat "$log"; exit 1; }; }

echo "== live checks (storage: ${SCRIPTORIUM_STORAGE_BACKEND:-local disk}) =="
for name in page-split search threads page-ranges sources reading meaning library; do
  run node "scripts/verify-$name-api.mjs"
done
if [ "${SCRIPTORIUM_STORAGE_BACKEND:-}" = "s3" ]; then run node scripts/verify-object-storage.mjs; fi
run node scripts/e2e-browser.mjs
# Last, because it empties the (throwaway) database and restores it from a backup.
SCRIPTORIUM_ALLOW_WIPE=yes run node scripts/verify-backup-restore.mjs
echo "== all live checks passed =="
