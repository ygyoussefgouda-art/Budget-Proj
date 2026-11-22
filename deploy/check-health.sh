#!/usr/bin/env sh
# Every few minutes from cron: is the app up, is the disk filling up, are backups recent?
# Alerts (ntfy / Telegram / webhook, see deploy/lib.sh) only when something is wrong,
# at most once an hour per problem.
set -eu
cd "$(dirname "$0")/.."
. ./deploy/lib.sh
load_env

STATE=backups/.alerts
mkdir -p "$STATE"
problem() { # key, message: alert once per hour per key
  f="$STATE/$1"
  if [ ! -f "$f" ] || [ -n "$(find "$f" -mmin +60 2>/dev/null)" ]; then
    touch "$f"
    warn "$2"
  fi
}
ok() { rm -f "$STATE/$1"; }

# 1. The app answers (through the local port, like the reverse proxy does)
PORT="${APP_PORT:-8090}"
if curl -fsS -m 10 "http://127.0.0.1:$PORT/api/health" | grep -q '"ok":true'; then ok health; else problem health "the app is not answering on /api/health"; fi

# 2. Disk space
USED=$(df -P . | awk 'NR==2 {gsub("%","",$5); print $5}')
if [ "${USED:-0}" -ge "${DISK_ALERT_PERCENT:-85}" ]; then problem disk "disk is ${USED}% full"; else ok disk; fi

# 3. Daily backup written in the last 26 hours
if [ -n "$(find backups -maxdepth 1 -name 'budget-me-*.sql.gz' -mmin -1560 2>/dev/null | head -n 1)" ]; then ok backup; else problem backup "no database backup in the last 26 hours"; fi

# 4. Off-site copy (only when it's set up): within 2 days
if [ -n "${OFFSITE_REMOTE:-}" ]; then
  if [ -f backups/.last-offsite ] && [ -z "$(find backups/.last-offsite -mmin +2880)" ]; then ok offsite; else problem offsite "no off-site backup in the last 2 days"; fi
fi
