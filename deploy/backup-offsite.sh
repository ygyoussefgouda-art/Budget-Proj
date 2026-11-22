#!/usr/bin/env sh
# Encrypted copy of the newest database backup to another place (a backup on the same VPS doesn't
# survive losing the VPS). Run nightly from cron (see DEPLOY.md, "Operations").
#
# Needs on the VPS: age (https://age-encryption.org) and rclone (https://rclone.org), both free.
# Settings in .env:
#   OFFSITE_REMOTE=b2:my-bucket/budget-me        # any rclone remote: B2, S3, Google Drive, another server (sftp)...
#   OFFSITE_AGE_RECIPIENT=age1...                # PUBLIC key; the private key stays OFF the VPS (password manager)
#   OFFSITE_KEEP_DAYS=90
set -eu
cd "$(dirname "$0")/.."
. ./deploy/lib.sh

load_env
: "${OFFSITE_REMOTE:?set OFFSITE_REMOTE in .env (an rclone remote, e.g. b2:bucket/budget-me)}"
: "${OFFSITE_AGE_RECIPIENT:?set OFFSITE_AGE_RECIPIENT in .env (age public key)}"
KEEP="${OFFSITE_KEEP_DAYS:-90}"
command -v age >/dev/null || fail "age is not installed (apt install age)"
command -v rclone >/dev/null || fail "rclone is not installed (https://rclone.org/install/)"

# A fresh, checked dump (backup-now.sh refuses incomplete ones)
sh deploy/backup-now.sh >/dev/null || fail "off-site backup: making the database dump failed"
LATEST=$(ls -1t backups/budget-me-*.sql.gz | head -n 1)
OUT="/tmp/$(basename "$LATEST").age"
trap 'rm -f "$OUT"' EXIT

age -r "$OFFSITE_AGE_RECIPIENT" -o "$OUT" "$LATEST" || fail "off-site backup: encryption failed"
rclone copyto "$OUT" "$OFFSITE_REMOTE/$(basename "$OUT")" --retries 3 || fail "off-site backup: upload to $OFFSITE_REMOTE failed"
# Only encrypted files ever leave the server; old ones are removed after KEEP days.
rclone delete "$OFFSITE_REMOTE" --min-age "${KEEP}d" --include 'budget-me-*.sql.gz.age' || warn "off-site backup: could not prune old copies"
date -u +%Y-%m-%dT%H:%M:%SZ > backups/.last-offsite
echo "Off-site backup done: $(basename "$OUT") -> $OFFSITE_REMOTE"
