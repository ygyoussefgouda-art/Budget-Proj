#!/usr/bin/env sh
# Go back to an earlier version when an update went wrong:
#   sh deploy/rollback.sh <tag or commit>      e.g.  sh deploy/rollback.sh e83525e
# Makes a backup first. Database migrations only ever add things, so older code keeps working on
# the newer database; if a newer migration must really be undone, restore the backup made before
# the update instead (sh deploy/restore.sh backups/<file>).
set -eu
cd "$(dirname "$0")/.."
. ./deploy/lib.sh
REF="${1:?usage: sh deploy/rollback.sh <tag or commit>  (see: git log --oneline -15)}"

git rev-parse --verify --quiet "$REF^{commit}" >/dev/null || { git fetch --tags --quiet; git rev-parse --verify "$REF^{commit}" >/dev/null; }
echo "==> Backing up the database first"
sh deploy/backup-now.sh
echo "==> Switching the code to $REF (was $(git rev-parse --short HEAD))"
git checkout --quiet --detach "$REF"
echo "==> Rebuilding and restarting"
docker compose up -d --build --remove-orphans
if wait_healthy 45; then
  echo "==> Done: running $(git rev-parse --short HEAD). To go back to the newest version: git checkout main && sh deploy/update.sh"
else
  echo "App did not become healthy. Recent logs:"; docker compose logs --tail=50 app; exit 1
fi
