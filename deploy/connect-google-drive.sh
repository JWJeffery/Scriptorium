#!/usr/bin/env bash
# One-time: connect the nightly backup to your Google Drive. Free; uses your existing Google account.
#
# Step 1, on your Mac (not the server). In Terminal:
#     brew install rclone            (or, without Homebrew:  sudo -v ; curl https://rclone.org/install.sh | sudo bash)
#     rclone authorize "drive" "eyJzY29wZSI6ImRyaXZlLmZpbGUifQ"
#   A browser opens: sign in to Google and allow access. Terminal then prints a long line that starts with
#   {"access_token": ... — copy that whole line.
#   (The odd text in quotes asks Google for the narrowest permission: Scriptorium can only see the files it
#   creates in your Drive, nothing else.)
#
# Step 2, on the server:
#     cd /opt/scriptorium && ./deploy/connect-google-drive.sh
#   and paste the line when asked.
set -Eeuo pipefail
trap 'echo "connect-google-drive.sh stopped at line $LINENO (command: $BASH_COMMAND)." >&2' ERR
umask 077
cd "$(dirname "$0")/.."
COMPOSE=(docker compose -f docker-compose.prod.yml --env-file .env.production)
CONF=deploy/rclone/rclone.conf
REMOTE="${DRIVE_REMOTE:-gdrive:Scriptorium}"

echo "Paste the line that starts with {\"access_token\" (from 'rclone authorize' on your Mac), then press Enter:"
IFS= read -r TOKEN
TOKEN="$(printf '%s' "$TOKEN" | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
case "$TOKEN" in
  \{*access_token*refresh_token*\}) ;;
  *) echo "That does not look like the token line (it should start with {\"access_token\" and end with }). Nothing was changed." >&2; exit 1 ;;
esac

mkdir -p deploy/rclone
chmod 700 deploy/rclone
printf '[gdrive]\ntype = drive\nscope = drive.file\ntoken = %s\n' "$TOKEN" > "$CONF.new"
chmod 600 "$CONF.new"
mv "$CONF.new" "$CONF"

echo "Testing the connection..."
"${COMPOSE[@]}" --profile tools run --rm -T rclone mkdir "$REMOTE"
date -u +"Connected %Y-%m-%d %H:%M UTC" | "${COMPOSE[@]}" --profile tools run --rm -T rclone rcat "$REMOTE/connected.txt"
"${COMPOSE[@]}" --profile tools run --rm -T rclone lsf "$REMOTE" > /dev/null
echo
echo "Google Drive is connected. A folder named 'Scriptorium' now exists in your Drive."
echo "The first backup copies your whole library and can take a while. Run it now with:"
echo "    ./deploy/backup.sh"
