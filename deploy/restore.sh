#!/usr/bin/env bash
# Disaster recovery: rebuild the library on this server from the backup on Google Drive (or from a database dump
# file already on this server). Read docs/BACKUPS.md first. It REPLACES whatever library this server has now.
#   cd /opt/scriptorium && ./deploy/restore.sh                  (newest backup on Google Drive)
#   cd /opt/scriptorium && ./deploy/restore.sh /path/db-X.dump  (that database dump; files still come from Drive)
# Before running it on a new server: clone the repository to /opt/scriptorium, create .env.production (docs/DEPLOY_VM.md),
# and run deploy/connect-google-drive.sh.
set -Eeuo pipefail
trap 'echo "restore.sh stopped at line $LINENO (command: $BASH_COMMAND)." >&2' ERR
umask 077
cd "$(dirname "$0")/.."
BACKUP_DIR="${BACKUP_DIR:-/var/backups/scriptorium}"
DRIVE_REMOTE="${DRIVE_REMOTE:-gdrive:Scriptorium}"
COMPOSE=(docker compose -f docker-compose.prod.yml --env-file .env.production)
rclone_run() { BACKUP_DIR="$BACKUP_DIR" "${COMPOSE[@]}" --profile tools run --rm -T rclone "$@"; }
mkdir -p "$BACKUP_DIR"

if [ "${RESTORE_CONFIRM:-}" != "yes" ]; then
  echo "This replaces the library on THIS server with the backup. Type RESTORE to continue:"
  read -r answer
  [ "$answer" = "RESTORE" ] || { echo "Cancelled. Nothing was changed."; exit 1; }
fi

echo "== starting the database"
"${COMPOSE[@]}" up -d --wait postgres

if [ $# -ge 1 ]; then
  dump="$1"
  [ -s "$dump" ] || { echo "No such dump: $dump" >&2; exit 1; }
else
  echo "== finding the newest database backup on $DRIVE_REMOTE"
  latest="$(rclone_run lsf "$DRIVE_REMOTE/database" --files-only --include 'db-*.dump' | sort | tail -n 1)"
  [ -n "$latest" ] || { echo "No database backups found on $DRIVE_REMOTE/database." >&2; exit 1; }
  rclone_run copy "$DRIVE_REMOTE/database/$latest" /backups/
  dump="$BACKUP_DIR/$latest"
fi
echo "Database backup: $dump"

echo "== copying the uploaded files back from $DRIVE_REMOTE/files"
rclone_run copy "$DRIVE_REMOTE/files" /data/storage --transfers 4 --retries 5

echo "== restoring the database"
"${COMPOSE[@]}" stop web worker 2>/dev/null || true
"${COMPOSE[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -U scriptorium -d postgres \
  -c "DROP DATABASE IF EXISTS scriptorium WITH (FORCE);" -c "CREATE DATABASE scriptorium OWNER scriptorium;"
"${COMPOSE[@]}" exec -T postgres pg_restore --exit-on-error --no-owner -U scriptorium -d scriptorium < "$dump"

echo "== starting Scriptorium"
# Builds the app image only if this server does not have it yet (a new server).
"${COMPOSE[@]}" up -d --wait --wait-timeout 900
echo "Restore finished. Open the app and check your library."
