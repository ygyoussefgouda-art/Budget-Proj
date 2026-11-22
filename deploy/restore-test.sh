#!/usr/bin/env sh
# Proves the newest backup can really be restored: loads it into a throwaway Postgres container
# (nothing of the running app is touched), checks the tables and row counts, then deletes it.
# Run monthly from cron; alerts on failure (see DEPLOY.md, "Operations").
#   sh deploy/restore-test.sh [backups/<file>.sql.gz]
set -eu
cd "$(dirname "$0")/.."
. ./deploy/lib.sh
load_env

FILE="${1:-$(ls -1t backups/budget-me-*.sql.gz 2>/dev/null | head -n 1)}"
[ -n "$FILE" ] && [ -f "$FILE" ] || fail "restore test: no backup file found"
gunzip -c "$FILE" | tail -n 5 | grep -q 'PostgreSQL database dump complete' || fail "restore test: $FILE is incomplete"

NAME="budget-me-restore-test-$$"
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
docker run -d --rm --name "$NAME" --network none -e POSTGRES_PASSWORD=restore-test -e POSTGRES_DB=restore_test postgres:16-alpine >/dev/null
i=0
until docker exec "$NAME" pg_isready -U postgres -d restore_test >/dev/null 2>&1; do
  i=$((i + 1)); [ "$i" -gt 60 ] && fail "restore test: test database did not start"; sleep 1
done
sleep 2

gunzip -c "$FILE" | docker exec -i "$NAME" psql -v ON_ERROR_STOP=1 -q -U postgres -d restore_test >/dev/null \
  || fail "restore test: $FILE could not be restored"

q() { docker exec "$NAME" psql -tA -U postgres -d restore_test -c "$1"; }
for t in users categories expenses goals loan_entries schema_migrations; do
  [ "$(q "SELECT to_regclass('public.$t') IS NOT NULL")" = "t" ] || fail "restore test: table $t is missing in $FILE"
done
USERS=$(q "SELECT count(*) FROM users")
EXPENSES=$(q "SELECT count(*) FROM expenses")
[ "$USERS" -gt 0 ] || fail "restore test: no accounts in $FILE"
date -u +%Y-%m-%dT%H:%M:%SZ > backups/.last-restore-test
echo "Restore test OK: $FILE ($USERS accounts, $EXPENSES expenses)"
