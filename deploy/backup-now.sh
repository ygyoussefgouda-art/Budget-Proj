#!/usr/bin/env sh
# Make a database backup right now (everything, including receipts) into ./backups.
#   sh deploy/backup-now.sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p backups
f="backups/budget-me-$(date +%Y-%m-%d_%H%M%S)-manual.sql.gz"
docker compose exec -T db sh -c 'pg_dump --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"' | gzip -9 > "$f.part"
mv "$f.part" "$f"
chmod 600 "$f"
echo "Backup written: $f"
