#!/usr/bin/env sh
# Update Budget me to the latest code and restart it. Run from the repo folder on the VPS:
#   sh deploy/update.sh
set -eu
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "No .env file. Run: cp .env.example .env && nano .env"; exit 1; }

echo "==> Backing up the database first"
sh deploy/backup-now.sh || echo "   (backup skipped: database not running yet)"

echo "==> Getting the latest code"
git pull --ff-only

echo "==> Building and restarting (other apps on this server are not touched)"
docker compose up -d --build --remove-orphans

echo "==> Waiting for the app to become healthy"
i=0
until [ "$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q app)")" = "healthy" ]; do
  i=$((i + 1))
  if [ "$i" -gt 30 ]; then
    echo "App did not become healthy. Recent logs:"; docker compose logs --tail=50 app; exit 1
  fi
  sleep 2
done
docker image prune -f >/dev/null
echo "==> Done. Budget me is running."
