#!/usr/bin/env bash
# One-time (safe to run again): set up the server's housekeeping.
#   cd /opt/scriptorium && ./deploy/server-setup.sh
#   - schedules the nightly backup at 03:00 server time (/etc/cron.d/scriptorium)
#   - keeps the backup log from growing forever (/etc/logrotate.d/scriptorium-backup)
#   - turns on automatic security updates, restarting the server at 04:30 only when an update needs it
#     (the app comes back by itself after a restart)
set -Eeuo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run this as root." >&2; exit 1; }
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"

cat > /etc/cron.d/scriptorium <<CRON
# Scriptorium nightly backup (installed by deploy/server-setup.sh)
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
0 3 * * * root cd $APP_DIR && ./deploy/backup.sh >> /var/log/scriptorium-backup.log 2>&1
CRON
chmod 644 /etc/cron.d/scriptorium
# Older instructions put the backup in root's own crontab; remove that line so it never runs twice.
if crontab -l 2>/dev/null | grep -q "deploy/backup.sh"; then
  crontab -l 2>/dev/null | grep -v "deploy/backup.sh" | crontab -
  echo "Removed the old backup line from root's crontab (it is now in /etc/cron.d/scriptorium)."
fi
echo "Nightly backup scheduled (03:00): /etc/cron.d/scriptorium"

cat > /etc/logrotate.d/scriptorium-backup <<'ROTATE'
/var/log/scriptorium-backup.log {
  weekly
  rotate 8
  compress
  missingok
  notifempty
}
ROTATE
echo "Backup log rotation set: /etc/logrotate.d/scriptorium-backup"

export DEBIAN_FRONTEND=noninteractive
apt-get install -y -qq unattended-upgrades > /dev/null
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'APT'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT
cat > /etc/apt/apt.conf.d/52scriptorium-unattended <<'APT'
// Installed by Scriptorium's deploy/server-setup.sh: security updates only, restart at 04:30 when required.
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
APT
echo "Automatic security updates are on (restart at 04:30 only when an update needs one)."
echo "Done."
