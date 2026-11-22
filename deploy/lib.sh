#!/usr/bin/env sh
# Shared helpers for the deploy/ scripts (sourced, not run).

# Read .env (KEY=value lines; comments and blanks skipped) without executing it.
load_env() {
  [ -f .env ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in '' | \#*) continue ;; esac
    key=${line%%=*}
    val=${line#*=}
    case "$key" in *[!A-Za-z0-9_]* | '') continue ;; esac
    # don't override what the caller already set
    eval "[ -n \"\${$key+x}\" ]" || export "$key=$val"
  done < .env
}

warn() { echo "WARNING: $*" >&2; alert "$*" || true; }
fail() { echo "FAILED: $*" >&2; alert "$*" || true; exit 1; }

# Send an alert to whatever is set in .env (all free):
#   ALERT_NTFY_TOPIC=budget-me-<random>   -> https://ntfy.sh (phone app, no account needed)
#   ALERT_TELEGRAM_BOT_TOKEN + ALERT_TELEGRAM_CHAT_ID
#   ALERT_WEBHOOK_URL                      -> POST with the text as body
alert() {
  msg="Budget me ($(hostname)): $*"
  sent=no
  if [ -n "${ALERT_NTFY_TOPIC:-}" ]; then
    curl -fsS -m 15 -H "Title: Budget me" -H "Priority: high" -d "$msg" "${ALERT_NTFY_SERVER:-https://ntfy.sh}/$ALERT_NTFY_TOPIC" >/dev/null && sent=yes
  fi
  if [ -n "${ALERT_TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${ALERT_TELEGRAM_CHAT_ID:-}" ]; then
    curl -fsS -m 15 "https://api.telegram.org/bot$ALERT_TELEGRAM_BOT_TOKEN/sendMessage" \
      --data-urlencode "chat_id=$ALERT_TELEGRAM_CHAT_ID" --data-urlencode "text=$msg" >/dev/null && sent=yes
  fi
  if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
    curl -fsS -m 15 -d "$msg" "$ALERT_WEBHOOK_URL" >/dev/null && sent=yes
  fi
  [ "$sent" = yes ]
}

wait_healthy() {
  i=0
  until [ "$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q app)" 2>/dev/null)" = "healthy" ]; do
    i=$((i + 1))
    [ "$i" -gt "${1:-45}" ] && return 1
    sleep 2
  done
}
