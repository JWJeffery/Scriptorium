#!/usr/bin/env bash
# Nightly backup. deploy/server-setup.sh schedules it every night at 03:00 (server time); run it by hand any time:
#   cd /opt/scriptorium && ./deploy/backup.sh
#
# What it does:
#   1. Dumps the database (books' records, highlights, notes, citations) to BACKUP_DIR on this server and checks
#      the dump can be read back. The newest KEEP_LOCAL dumps are kept here.
#   2. If Google Drive is connected (deploy/connect-google-drive.sh), copies that dump to Drive (dumps older than
#      30 days are removed from Drive) and brings Drive's copy of the uploaded files up to date. Only changed files
#      are sent. A file that changed or was deleted here is MOVED on Drive into files-replaced/<date> rather than
#      lost; those are kept 90 days.
#   3. Writes backup-status.json into the app's data volume. The app warns you (a banner) when the last good
#      off-server backup is older than 36 hours, failed, or Drive is not connected.
# It never needs the web server, and it holds nothing large in memory.
set -Eeuo pipefail
umask 077
cd "$(dirname "$0")/.."

BACKUP_DIR="${BACKUP_DIR:-/var/backups/scriptorium}"
KEEP_LOCAL="${KEEP_LOCAL:-3}"
DRIVE_REMOTE="${DRIVE_REMOTE:-gdrive:Scriptorium}"
COMPOSE=(docker compose -f docker-compose.prod.yml --env-file .env.production)
STAMP="$(date -u +%Y%m%d-%H%M%S)"
STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
STEP="starting"
mkdir -p "$BACKUP_DIR"
# Only one backup at a time (the nightly one and one started by hand or by update.sh).
exec 9> "$BACKUP_DIR/.lock"
flock -n 9 || { echo "Another backup is already running; this one was skipped."; exit 0; }

# The rclone container sees: /data (the app's data volume), /backups (BACKUP_DIR), /config/rclone (the Drive login).
rclone_run() { BACKUP_DIR="$BACKUP_DIR" "${COMPOSE[@]}" --profile tools run --rm -T rclone "$@"; }
drive_connected() { [ -s deploy/rclone/rclone.conf ] && grep -q "^\[${DRIVE_REMOTE%%:*}\]" deploy/rclone/rclone.conf; }

write_status() { # ok offsite message
  local json
  json=$(printf '{"startedAt":"%s","finishedAt":"%s","ok":%s,"offsite":%s,"remote":"%s","step":"%s","message":"%s","databaseDump":"%s"}' \
    "$STARTED" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" "$DRIVE_REMOTE" "$STEP" "${3//\"/\'}" "db-$STAMP.dump")
  printf '%s\n' "$json" > "$BACKUP_DIR/backup-status.json"
  # Into the data volume, where the app reads it. Without Drive this still runs (the rclone image has a shell).
  BACKUP_DIR="$BACKUP_DIR" "${COMPOSE[@]}" --profile tools run --rm -T --entrypoint sh rclone \
    -c 'cat /backups/backup-status.json > /data/backup-status.json.partial && mv /data/backup-status.json.partial /data/backup-status.json' \
    || echo "could not write the status file into the data volume" >&2
}
on_error() { write_status false false "The backup stopped at step: $STEP. See /var/log/scriptorium-backup.log."; echo "[$STAMP] FAILED at: $STEP" >&2; }
trap on_error ERR

echo "[$STAMP] database dump"
STEP="database dump"
"${COMPOSE[@]}" exec -T postgres pg_dump -U scriptorium -Fc scriptorium > "$BACKUP_DIR/db-$STAMP.dump.partial"
STEP="checking the database dump"
[ -s "$BACKUP_DIR/db-$STAMP.dump.partial" ] || { echo "empty database dump" >&2; false; }
# A dump that pg_restore cannot list is worse than none.
"${COMPOSE[@]}" exec -T postgres pg_restore --list < "$BACKUP_DIR/db-$STAMP.dump.partial" > /dev/null
mv "$BACKUP_DIR/db-$STAMP.dump.partial" "$BACKUP_DIR/db-$STAMP.dump"
rm -f "$BACKUP_DIR"/*.partial

STEP="keeping the newest $KEEP_LOCAL dumps on this server"
ls -1t "$BACKUP_DIR"/db-*.dump 2>/dev/null | tail -n +"$((KEEP_LOCAL + 1))" | xargs -r rm -f

if ! drive_connected; then
  write_status true false "Google Drive is not connected, so this backup exists only on the server. Run deploy/connect-google-drive.sh."
  echo "[$STAMP] done (this server only: Google Drive is not connected)"
  exit 0
fi

echo "[$STAMP] copying the database dump to $DRIVE_REMOTE"
STEP="copying the database dump to Google Drive"
rclone_run copy "/backups/db-$STAMP.dump" "$DRIVE_REMOTE/database" --retries 5
STEP="removing database dumps older than 30 days from Google Drive"
# Pruning is housekeeping: if it fails (or there is nothing to prune yet) the backup itself still counts.
rclone_run delete "$DRIVE_REMOTE/database" --min-age 30d --retries 1 2>/dev/null || echo "note: nothing pruned from $DRIVE_REMOTE/database"

echo "[$STAMP] bringing Google Drive's copy of the uploaded files up to date"
STEP="copying the uploaded files to Google Drive"
rclone_run sync /data/storage "$DRIVE_REMOTE/files" --backup-dir "$DRIVE_REMOTE/files-replaced/$STAMP" --retries 5 --transfers 2 --checkers 4
STEP="removing replaced files older than 90 days from Google Drive"
rclone_run delete "$DRIVE_REMOTE/files-replaced" --min-age 90d --rmdirs --retries 1 2>/dev/null || echo "note: nothing pruned from $DRIVE_REMOTE/files-replaced"

# The old full-library ZIPs from before Drive was connected only take up disk space now.
STEP="removing old full-library ZIPs from this server"
rm -f "$BACKUP_DIR"/app-*.zip

STEP="done"
write_status true true "Database and files are backed up on Google Drive."
echo "[$STAMP] done (Google Drive: $DRIVE_REMOTE)"
