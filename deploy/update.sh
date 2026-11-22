#!/usr/bin/env bash
# Update Scriptorium to the newest version on GitHub. One command:
#   cd /opt/scriptorium && ./deploy/update.sh
# It backs up first (and stops if the backup fails), pulls the new code, rebuilds, waits until the app reports
# healthy, then clears out old build leftovers so the disk does not fill up.
set -Eeuo pipefail
trap 'echo "update.sh stopped at line $LINENO (command: $BASH_COMMAND)." >&2' ERR
cd "$(dirname "$0")/.."
COMPOSE=(docker compose -f docker-compose.prod.yml --env-file .env.production)

branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$branch" != "main" ]; then
  echo "This server is on branch '$branch', not 'main'. Switch once with:" >&2
  echo "    git fetch origin && git checkout main && git pull --ff-only" >&2
  exit 1
fi

echo "== 1/4 backup"
./deploy/backup.sh || { echo "The backup failed, so the update was not started. Nothing has changed." >&2; exit 1; }

echo "== 2/4 new code"
before="$(git rev-parse --short HEAD)"
git pull --ff-only
after="$(git rev-parse --short HEAD)"
[ "$before" = "$after" ] && echo "Already up to date ($after); rebuilding anyway." || git log --oneline "$before..$after"

echo "== 3/4 rebuild and restart (a few minutes)"
"${COMPOSE[@]}" up -d --build --remove-orphans --wait --wait-timeout 600

echo "== 4/4 tidy up"
docker image prune -f > /dev/null
docker builder prune -f --keep-storage 3GB > /dev/null
"${COMPOSE[@]}" ps --format "table {{.Service}}\t{{.Status}}"
df -h / | awk 'NR==2 {print "Disk: " $3 " used of " $2 " (" $5 ")"}'
echo "Scriptorium is updated to $after."
