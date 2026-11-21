#!/usr/bin/env sh
# Restore the whole database from a backup file. THIS REPLACES ALL CURRENT DATA.
#   sh deploy/restore.sh backups/budget-me-2026-01-31_0300.sql.gz
set -eu
cd "$(dirname "$0")/.."
file="${1:-}"
[ -f "$file" ] || { echo "Usage: sh deploy/restore.sh <backup.sql.gz>"; exit 1; }

printf 'This replaces ALL data in Budget me with %s. Type RESTORE to continue: ' "$file"
read -r answer
[ "$answer" = "RESTORE" ] || { echo "Cancelled."; exit 1; }

echo "==> Safety backup of the current data"
sh deploy/backup-now.sh

echo "==> Stopping the app"
docker compose stop app

echo "==> Restoring"
docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -q -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS \"$POSTGRES_DB\" WITH (FORCE);" -c "CREATE DATABASE \"$POSTGRES_DB\" OWNER \"$POSTGRES_USER\";"'
gunzip -c "$file" | docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -q -U "$POSTGRES_USER" -d "$POSTGRES_DB"'

echo "==> Starting the app"
docker compose start app
echo "==> Restore finished."
