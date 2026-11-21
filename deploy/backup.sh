#!/usr/bin/env bash
# Nightly backup for the production server. Run from the project folder (cron does this for you):
#   0 3 * * *  cd /opt/scriptorium && ./deploy/backup.sh >> /var/log/scriptorium-backup.log 2>&1
# It makes two files in BACKUP_DIR: a full database dump, and the app's own backup ZIP (database + every
# uploaded file). It keeps the newest KEEP of each. If rclone is configured, it also copies them off the server.
set -euo pipefail
cd "$(dirname "$0")/.."

BACKUP_DIR="${BACKUP_DIR:-/var/backups/scriptorium}"
KEEP="${KEEP:-14}"
COMPOSE=(docker compose -f docker-compose.prod.yml --env-file .env.production)
STAMP="$(date -u +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

echo "[$STAMP] database dump"
"${COMPOSE[@]}" exec -T postgres pg_dump -U scriptorium -Fc scriptorium > "$BACKUP_DIR/db-$STAMP.dump"

echo "[$STAMP] app backup (database + files)"
"${COMPOSE[@]}" exec -T web node -e '
  const auth = Buffer.from(process.env.SCRIPTORIUM_AUTH_USER + ":" + process.env.SCRIPTORIUM_AUTH_PASSWORD).toString("base64");
  fetch("http://127.0.0.1:3000/api/backup/download", { headers: { authorization: "Basic " + auth } })
    .then(async (r) => { if (!r.ok) throw new Error("backup failed: " + r.status); process.stdout.write(Buffer.from(await r.arrayBuffer())); })
    .catch((e) => { console.error(e.message); process.exit(1); });
' > "$BACKUP_DIR/app-$STAMP.zip"

# A backup that is empty or not a ZIP is worse than none.
[ -s "$BACKUP_DIR/db-$STAMP.dump" ] || { echo "empty database dump" >&2; exit 1; }
head -c 2 "$BACKUP_DIR/app-$STAMP.zip" | grep -q PK || { echo "app backup is not a ZIP" >&2; exit 1; }

# Keep the newest $KEEP of each kind.
for kind in db app; do
  ls -1t "$BACKUP_DIR"/$kind-*.* 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f
done

if command -v rclone >/dev/null 2>&1 && [ -n "${RCLONE_REMOTE:-}" ]; then
  echo "[$STAMP] copying off the server to $RCLONE_REMOTE"
  rclone copy "$BACKUP_DIR" "$RCLONE_REMOTE" --include "db-$STAMP.dump" --include "app-$STAMP.zip"
fi
echo "[$STAMP] done"
