#!/usr/bin/env sh
# Make a database backup right now (everything, including receipts) into ./backups.
#   sh deploy/backup-now.sh
# Exits with an error (and keeps no file) if the dump is incomplete.
set -eu
cd "$(dirname "$0")/.."
mkdir -p backups
f="backups/budget-me-$(date +%Y-%m-%d_%H%M%S)-manual.sql.gz"
# sh has no "pipefail": a failed pg_dump would still leave gzip happy. So check the file afterwards:
# a complete plain-format dump always ends with "PostgreSQL database dump complete".
docker compose exec -T db sh -c 'pg_dump --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"' | gzip -9 > "$f.part" || true
if ! gunzip -c "$f.part" 2>/dev/null | tail -n 5 | grep -q 'PostgreSQL database dump complete'; then
  rm -f "$f.part"
  echo "BACKUP FAILED: the database dump is incomplete (is the db container running?). Nothing was saved." >&2
  exit 1
fi
mv "$f.part" "$f"
chmod 600 "$f"
echo "Backup written: $f ($(du -h "$f" | cut -f1))"
